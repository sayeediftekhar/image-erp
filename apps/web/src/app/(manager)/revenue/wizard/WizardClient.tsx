'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { EntityCapabilities } from '@/lib/capabilities'
import type { Channel } from '@/lib/revenue/channels'
import Step1DaySetup from './Step1DaySetup'
import StepPlaceholder from './StepPlaceholder'

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
    steps.push({ id: 'MORNING',    label: 'Morning clinic',   isPlaceholder: true, phase: 'T3c' })
  if (savedChannels.includes('EVENING'))
    steps.push({ id: 'EVENING',    label: 'Evening clinic',   isPlaceholder: true, phase: 'T3c' })
  if (savedChannels.includes('AFTERHOURS'))
    steps.push({ id: 'AFTERHOURS', label: 'After-hours',      isPlaceholder: true, phase: 'T3c' })
  if (savedChannels.includes('SATELLITE')) {
    for (let i = 1; i <= savedTeamCount; i++) {
      steps.push({ id: `SATELLITE_TEAM_${i}`, label: `Satellite — Team ${i}`, isPlaceholder: true, phase: 'T3c' })
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
  const [savedChannels, setSavedChannels] = useState<Channel[]>(() => parseSavedChannels(initialDraft))
  const [savedTeamCount, setSavedTeamCount] = useState<number>(() => parseSavedTeamCount(initialDraft))

  // Live toggle state — changes as manager toggles; committed to DB on Save.
  const [activeChannels, setActiveChannels] = useState<Set<Channel>>(
    () => new Set(parseSavedChannels(initialDraft)),
  )
  const [teamCount, setTeamCount] = useState<number>(() => parseSavedTeamCount(initialDraft))

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
    const satellite_teams = channelsArray.includes('SATELLITE')
      ? Array.from({ length: teamCount }, (_, i) => ({
          team: `TEAM_${i + 1}`,
          patients_new: 0, patients_old: 0, services: 0,
          service_charge: 0, rdf_medicine_sales: 0,
          lab_tests: 0, lab_revenue: 0, usg: [],
        }))
      : []

    const partialDraft = {
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
      setCurrentStepIndex(1)
    } catch {
      setSaveError('Network error — check your connection and try again')
    } finally {
      setIsSaving(false)
    }
  }

  // Unused in T3b (no placeholder step saves), but wired for T3c to extend.
  void revenueDayId

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
        {currentStep.id === 'DAY_SETUP' ? (
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
        ) : (
          <StepPlaceholder
            label={currentStep.label}
            phase={currentStep.phase ?? 'T3c'}
          />
        )}
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

        {!isFirst && !isLast && (
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
