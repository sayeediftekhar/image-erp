'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { EntityCapabilities } from '@/lib/capabilities'
import type { Channel } from '@/lib/revenue/channels'
import { mergeSliceIntoDraft, mergeTeamStubs } from '@/lib/revenue/draft-merge'
import { stripInactiveChannels } from '@/lib/revenue/strip-inactive'
import Step1DaySetup from './Step1DaySetup'
import OutdoorSession from './OutdoorSession'
import AfterhoursSession from './AfterhoursSession'
import DeliveryStep from './DeliveryStep'
import FinancialStep from './FinancialStep'
import ReviewStep from './ReviewStep'

interface StepDescriptor {
  id:            string
  label:         string
  phase?:        'T3c' | 'T3d'
}

function buildSteps(
  savedChannels: Channel[],
  savedTeamCount: number,
  caps: EntityCapabilities,
): StepDescriptor[] {
  const steps: StepDescriptor[] = [
    { id: 'DAY_SETUP', label: 'Day setup' },
  ]
  if (savedChannels.includes('MORNING'))
    steps.push({ id: 'MORNING',    label: 'Morning clinic',   phase: 'T3c' })
  if (savedChannels.includes('EVENING'))
    steps.push({ id: 'EVENING',    label: 'Evening clinic',   phase: 'T3c' })
  if (savedChannels.includes('AFTERHOURS'))
    steps.push({ id: 'AFTERHOURS', label: 'After-hours',      phase: 'T3c' })
  if (savedChannels.includes('SATELLITE')) {
    for (let i = 1; i <= savedTeamCount; i++) {
      steps.push({ id: `SATELLITE_TEAM_${i}`, label: `Satellite — Team ${i}`, phase: 'T3c' })
    }
  }
  if (savedChannels.includes('DELIVERY') && (caps.delivery.nvd || caps.delivery.csection))
    steps.push({ id: 'DELIVERY',   label: 'Deliveries',       phase: 'T3d' })
  steps.push({ id: 'FINANCIAL', label: 'Financial wrap-up', phase: 'T3d' })
  steps.push({ id: 'REVIEW',    label: 'Review & submit',   phase: 'T3d' })
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

function getDeliveryData(draftData: Record<string, unknown>): unknown {
  return draftData.delivery ?? null
}

function getFinancialData(draftData: Record<string, unknown>): unknown {
  return draftData.financial ?? null
}

export interface WizardClientProps {
  date:             string
  entityCode:       string
  entityName:       string
  caps:             EntityCapabilities
  initialDraft:     unknown
  revenueDayId:     string | null
  openingCash:      number
}

export default function WizardClient({
  date,
  entityCode,
  entityName,
  caps,
  initialDraft,
  revenueDayId: initialRevenueDayId,
  openingCash,
}: WizardClientProps) {
  const router = useRouter()

  const [savedChannels,  setSavedChannels]  = useState<Channel[]>(() => parseSavedChannels(initialDraft))
  const [savedTeamCount, setSavedTeamCount] = useState<number>(() => parseSavedTeamCount(initialDraft))

  const [activeChannels, setActiveChannels] = useState<Set<Channel>>(
    () => new Set(parseSavedChannels(initialDraft)),
  )
  const [teamCount, setTeamCount] = useState<number>(() => parseSavedTeamCount(initialDraft))

  // Full accumulated draft — merged on every successful step save.
  const [draftData, setDraftData] = useState<Record<string, unknown>>(
    () => (initialDraft ?? {}) as Record<string, unknown>,
  )

  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [revenueDayId, setRevenueDayId] = useState<string | null>(initialRevenueDayId)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const steps = useMemo(
    () => buildSteps(savedChannels, savedTeamCount, caps),
    [savedChannels, savedTeamCount, caps],
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
    const existingTeams = Array.isArray(draftData.satellite_teams)
      ? draftData.satellite_teams as unknown[]
      : []
    const satellite_teams = channelsArray.includes('SATELLITE')
      ? mergeTeamStubs(existingTeams, teamCount)
      : []

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

  async function handleSubmit() {
    if (isSaving || !revenueDayId) return
    setSaveError(null)
    setIsSaving(true)

    try {
      // Strip deselected channel slices BEFORE the final save.
      // The engine reads draft_data from DB; a lingering deselected slice would post.
      const strippedDraft = stripInactiveChannels(draftData)

      // Final save-draft with the stripped data
      const saveRes = await fetch('/api/manager/save-draft', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ date, partialDraft: strippedDraft }),
      })
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({})) as { error?: string }
        setSaveError(err.error ?? 'Failed to save before submit — please try again')
        return
      }

      // Submit: engine reads the stripped draft from DB and posts to ledger
      const submitRes = await fetch('/api/manager/submit-day', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ revenueDayId }),
      })
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({})) as { error?: string; code?: string }
        if (err.code === 'ALREADY_SUBMITTED') {
          setSaveError('This day is already submitted.')
        } else {
          setSaveError(err.error ?? 'Submit failed — please try again')
        }
        return
      }

      router.push('/revenue')
    } catch {
      setSaveError('Network error — check your connection and try again')
    } finally {
      setIsSaving(false)
    }
  }

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

    if (currentStep.id === 'DELIVERY') {
      return (
        <DeliveryStep
          key="DELIVERY"
          caps={caps}
          initialData={getDeliveryData(draftData)}
          onSave={slice => handleSaveSessionStep('DELIVERY', slice)}
          isSaving={isSaving}
          saveError={saveError}
        />
      )
    }

    if (currentStep.id === 'FINANCIAL') {
      return (
        <FinancialStep
          key="FINANCIAL"
          draftData={draftData}
          openingCash={openingCash}
          initialData={getFinancialData(draftData)}
          onSave={slice => handleSaveSessionStep('FINANCIAL', slice)}
          isSaving={isSaving}
          saveError={saveError}
        />
      )
    }

    if (currentStep.id === 'REVIEW') {
      return (
        <ReviewStep
          key="REVIEW"
          draftData={draftData}
          openingCash={openingCash}
          date={date}
          entityName={entityName}
          readOnly={false}
          onSubmit={handleSubmit}
          onBack={() => setCurrentStepIndex(i => i - 1)}
          isSaving={isSaving}
          saveError={saveError}
        />
      )
    }

    return null
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

      {/* Footer navigation — only for DAY_SETUP and REVIEW's back button */}
      {(isFirst || currentStep.id === 'REVIEW') && (
        <div className="bg-white border-t border-gray-200 px-4 py-3 flex gap-3 shrink-0">
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
        </div>
      )}

      {/* Back button for non-first, non-review steps that handle their own save */}
      {!isFirst && currentStep.id !== 'REVIEW' && (
        <div className="bg-white border-t border-gray-200 px-4 py-3 flex gap-3 shrink-0">
          <button
            onClick={() => setCurrentStepIndex(i => i - 1)}
            className="min-h-[44px] rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm px-5"
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  )
}
