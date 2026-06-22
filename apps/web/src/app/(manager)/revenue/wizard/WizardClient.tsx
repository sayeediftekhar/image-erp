'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { EntityCapabilities } from '@/lib/capabilities'
import type { Channel } from '@/lib/revenue/channels'
import { mergeSliceIntoDraft, mergeTeamStubs } from '@/lib/revenue/draft-merge'
import Step1DaySetup from './Step1DaySetup'
import StepPlaceholder from './StepPlaceholder'
import OutdoorSession from './OutdoorSession'
import AfterhoursSession from './AfterhoursSession'

interface StepDescriptor {
  id:            string
  label:         string
  isPlaceholder: boolean
  phase?:        'T3c' | 'T3d'
}

function buildSteps(savedChannels: Channel[], savedTeamCount: number): StepDescriptor[] {
  const steps: StepDescriptor[] = [
    { id: 'DAY_SETUP', label: 'Day setup', isPlaceholder: false },
  ]
  if (savedChannels.includes('MORNING'))
    steps.push({ id: 'MORNING',    label: 'Morning clinic',   isPlaceholder: false, phase: 'T3c' })
  if (savedChannels.includes('EVENING'))
    steps.push({ id: 'EVENING',    label: 'Evening clinic',   isPlaceholder: false, phase: 'T3c' })
  if (savedChannels.includes('AFTERHOURS'))
    steps.push({ id: 'AFTERHOURS', label: 'After-hours',      isPlaceholder: false, phase: 'T3c' })
  if (savedChannels.includes('SATELLITE')) {
    for (let i = 1; i <= savedTeamCount; i++) {
      steps.push({ id: `SATELLITE_TEAM_${i}`, label: `Satellite — Team ${i}`, isPlaceholder: false, phase: 'T3c' })
    }
  }
  if (savedChannels.includes('DELIVERY'))
    steps.push({ id: 'DELIVERY',   label: 'Deliveries',       isPlaceholder: true, phase: 'T3d' })
  steps.push({ id: 'FINANCIAL', label: 'Financial wrap-up', isPlaceholder: true, phase: 'T3d' })
  steps.push({ id: 'REVIEW',    label: 'Review & submit',   isPlaceholder: true, phase: 'T3d' })
  return steps
}

function parseSavedChannels(initialDraft: unknown): Channel[] {
  if (initialDraft && typeof initialDraft === 'object' && !Array.isArray(initialDraft)) {
    const d = initialDraft as Record<string, unknown>
    if (Array.isArray(d.channels_active)) return d.channels_active as Channel[]
  }
  return []
}

function parseSavedTeamCount(initialDraft: unknown): number {
  if (initialDraft && typeof initialDraft === 'object' && !Array.isArray(initialDraft)) {
    const d = initialDraft as Record<string, unknown>
    if (Array.isArray(d.satellite_teams) && d.satellite_teams.length > 0) {
      return d.satellite_teams.length
    }
  }
  return 2
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function getSessionData(draftData: Record<string, unknown>, channel: string): unknown {
  const sessions = draftData.sessions as Record<string, unknown> | undefined
  return sessions?.[channel] ?? null
}

function getSatelliteData(draftData: Record<string, unknown>, teamIndex: number): unknown {
  const teams = draftData.satellite_teams as unknown[] | undefined
  return teams?.[teamIndex] ?? null
}

export interface WizardClientProps {
  date:             string
  entityCode:       string
  entityName:       string
  caps:             EntityCapabilities
  initialDraft:     unknown
  revenueDayId:     string | null
}

export default function WizardClient({
  date,
  entityCode,
  entityName,
  caps,
  initialDraft,
  revenueDayId: initialRevenueDayId,
}: WizardClientProps) {
  const router = useRouter()

  // Stable "last saved" state — only changes after a successful Save & Continue.
  // Steps array is derived from this, so step count is stable while toggles change.
  const [savedChannels,  setSavedChannels]  = useState<Channel[]>(() => parseSavedChannels(initialDraft))
  const [savedTeamCount, setSavedTeamCount] = useState<number>(() => parseSavedTeamCount(initialDraft))

  // Live toggle state — changes as manager toggles; committed to DB on Save.
  const [activeChannels, setActiveChannels] = useState<Set<Channel>>(
    () => new Set(parseSavedChannels(initialDraft)),
  )
  const [teamCount, setTeamCount] = useState<number>(() => parseSavedTeamCount(initialDraft))

  // Full accumulated draft — merged on every successful step save. Initialized
  // from server-fetched initialDraft so resume rehydrates all session components.
  // channels_active is authoritative for T3d; sessions.* for deselected channels
  // are preserved here (not cleared) so a fat-finger toggle doesn't destroy data.
  const [draftData, setDraftData] = useState<Record<string, unknown>>(
    () => (initialDraft ?? {}) as Record<string, unknown>,
  )

  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [revenueDayId, setRevenueDayId] = useState<string | null>(initialRevenueDayId)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Recomputed only when a Save succeeds — not on every toggle change.
  const steps = useMemo(
    () => buildSteps(savedChannels, savedTeamCount),
    [savedChannels, savedTeamCount],
  )
  const currentStep = steps[currentStepIndex]
  const isFirst = currentStepIndex === 0
  const isLast  = currentStepIndex === steps.length - 1

  function toggleChannel(token: Channel) {
    setActiveChannels(prev => {
      const next = new Set(prev)
      if (next.has(token)) next.delete(token)
      else next.add(token)
      return next
    })
  }

  async function handleSaveStep1() {
    if (activeChannels.size === 0 || isSaving) return
    setSaveError(null)
    setIsSaving(true)

    const channelsArray = Array.from(activeChannels)

    // Preserve existing team data; only append/truncate for count changes.
    // Growing 2→3: TEAM_1+TEAM_2 kept, TEAM_3 gets an empty stub.
    // Shrinking 3→2: TEAM_3 dropped; TEAM_1+TEAM_2 preserved.
    const existingTeams = Array.isArray(draftData.satellite_teams)
      ? draftData.satellite_teams as unknown[]
      : []
    const satellite_teams = channelsArray.includes('SATELLITE')
      ? mergeTeamStubs(existingTeams, teamCount)
      : []

    // Spread draftData so deselected-channel session slices are preserved.
    // channels_active is the authority for T3d posting; lingering slices are harmless.
    const partialDraft: Record<string, unknown> = {
      ...draftData,
      revenue_date:    date,
      entity_code:     entityCode,
      channels_active: channelsArray,
      satellite_teams,
    }

    try {
      const res = await fetch('/api/manager/save-draft', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ date, partialDraft }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        setSaveError(err.error ?? 'Failed to save — please try again')
        return
      }

      const data = await res.json() as { revenueDayId: string }
      setRevenueDayId(data.revenueDayId)
      setSavedChannels(channelsArray)
      setSavedTeamCount(teamCount)
      setDraftData(partialDraft)
      setCurrentStepIndex(1)
    } catch {
      setSaveError('Network error — check your connection and try again')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveSessionStep(stepId: string, slice: unknown) {
    if (isSaving) return
    setSaveError(null)
    setIsSaving(true)

    const merged = mergeSliceIntoDraft(draftData, stepId, slice)

    try {
      const res = await fetch('/api/manager/save-draft', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ date, partialDraft: merged }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        setSaveError(err.error ?? 'Failed to save — please try again')
        return
      }

      const data = await res.json() as { revenueDayId: string }
      setRevenueDayId(data.revenueDayId)
      setDraftData(merged)
      setCurrentStepIndex(i => i + 1)
    } catch {
      setSaveError('Network error — check your connection and try again')
    } finally {
      setIsSaving(false)
    }
  }

  // revenueDayId is maintained here for T3d to reference during submitRevenueDay.
  void revenueDayId

  function renderStepContent() {
    if (currentStep.id === 'DAY_SETUP') {
      return (
        <div className="p-5 space-y-4">
          <Step1DaySetup
            caps={caps}
            activeChannels={activeChannels}
            teamCount={teamCount}
            onToggleChannel={toggleChannel}
            onTeamCountChange={setTeamCount}
          />
          {activeChannels.size === 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-amber-800 text-sm leading-relaxed">
                No channels selected. If the clinic was fully closed today, use{' '}
                <button
                  onClick={() => router.push('/revenue')}
                  className="font-semibold underline"
                >
                  Mark as closed
                </button>{' '}
                from the day list instead.
              </p>
            </div>
          )}
          {saveError && (
            <p className="text-red-600 text-sm font-medium" role="alert">{saveError}</p>
          )}
        </div>
      )
    }

    if (currentStep.id === 'MORNING' || currentStep.id === 'EVENING') {
      return (
        <OutdoorSession
          key={currentStep.id}
          channel={currentStep.id as 'MORNING' | 'EVENING'}
          label={currentStep.label}
          initialData={getSessionData(draftData, currentStep.id)}
          onSave={slice => handleSaveSessionStep(currentStep.id, slice)}
          isSaving={isSaving}
          saveError={saveError}
        />
      )
    }

    if (currentStep.id === 'AFTERHOURS') {
      return (
        <AfterhoursSession
          key="AFTERHOURS"
          initialData={getSessionData(draftData, 'AFTERHOURS')}
          onSave={slice => handleSaveSessionStep('AFTERHOURS', slice)}
          isSaving={isSaving}
          saveError={saveError}
        />
      )
    }

    if (currentStep.id.startsWith('SATELLITE_TEAM_')) {
      const teamNum   = parseInt(currentStep.id.replace('SATELLITE_TEAM_', ''), 10)
      const teamIndex = teamNum - 1
      return (
        <OutdoorSession
          key={currentStep.id}
          channel="SATELLITE"
          label={currentStep.label}
          teamToken={`TEAM_${teamNum}`}
          initialData={getSatelliteData(draftData, teamIndex)}
          onSave={slice => handleSaveSessionStep(currentStep.id, slice)}
          isSaving={isSaving}
          saveError={saveError}
        />
      )
    }

    return <StepPlaceholder label={currentStep.label} phase={currentStep.phase ?? 'T3d'} />
  }

  return (
    <div
      className="min-h-full flex flex-col"
      style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
    >
      {/* Header */}
      <header className="px-4 pt-5 pb-3 shrink-0">
        <button
          onClick={() => router.push('/revenue')}
          className="text-white/60 text-sm font-medium min-h-[44px] flex items-center gap-1"
        >
          ← Day list
        </button>
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mt-1">{entityName}</p>
        <h1 className="text-white text-2xl font-bold leading-tight mt-0.5">Day Entry</h1>
        <p className="text-white/70 text-sm mt-1">{formatDate(date)}</p>
      </header>

      {/* Step progress indicator */}
      <div className="px-4 pb-3 shrink-0">
        <p className="text-white/60 text-xs">
          Step {currentStepIndex + 1} of {steps.length} · {currentStep.label}
        </p>
        <div className="mt-1.5 h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-1 bg-white/70 rounded-full transition-all duration-300"
            style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl overflow-auto">
        {renderStepContent()}
      </div>

      {/* Footer navigation */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 flex gap-3 shrink-0">
        {!isFirst && (
          <button
            onClick={() => setCurrentStepIndex(i => i - 1)}
            className="flex-1 min-h-[44px] rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm"
          >
            ← Back
          </button>
        )}

        {isFirst && (
          <button
            onClick={handleSaveStep1}
            disabled={activeChannels.size === 0 || isSaving}
            className="flex-1 min-h-[44px] rounded-xl font-semibold text-sm text-white disabled:opacity-40 transition-opacity"
            style={{ background: '#13007D' }}
          >
            {isSaving ? 'Saving…' : 'Save & Continue →'}
          </button>
        )}

        {/* T3c session steps: Save & Continue is inside the session component itself. */}

        {!isFirst && currentStep.phase === 'T3d' && !isLast && (
          <button
            onClick={() => setCurrentStepIndex(i => i + 1)}
            className="flex-1 min-h-[44px] rounded-xl font-semibold text-sm text-white"
            style={{ background: '#13007D' }}
          >
            Next →
          </button>
        )}

        {isLast && (
          <button
            disabled
            className="flex-1 min-h-[44px] rounded-xl font-semibold text-sm text-white opacity-40 cursor-not-allowed"
            style={{ background: '#13007D' }}
          >
            Submit — coming in T3d
          </button>
        )}
      </div>
    </div>
  )
}
