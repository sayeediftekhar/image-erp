'use client'

import {
  computeDraftFundSplit,
  computeAdvancesReceived,
  computeReconciliation,
} from '@/lib/revenue/reconciliation'

function tk(v: number): string {
  return 'Tk ' + Math.round(v).toLocaleString('en-IN')
}

function safeNum(v: unknown): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ── Per-channel breakdown helpers ─────────────────────────────────────────────

interface SessionRow {
  label:         string
  serviceCharge: number
  rdfMed:        number
  lab:           number
  usgRevenue:    number
  patients?:     number
  cases?:        number
}

function getSessionRow(
  sessions: Record<string, unknown>,
  key: 'MORNING' | 'EVENING',
  label: string,
): SessionRow | null {
  const s = sessions[key] as Record<string, unknown> | undefined
  if (!s) return null
  const usg = Array.isArray(s.usg) ? s.usg as Array<Record<string, unknown>> : []
  return {
    label,
    serviceCharge: safeNum(s.service_charge),
    rdfMed:        safeNum(s.rdf_medicine_sales),
    lab:           safeNum(s.lab_revenue),
    usgRevenue:    usg.reduce((sum, u) => sum + safeNum(u.revenue), 0),
    patients:      safeNum(s.patients_new) + safeNum(s.patients_old),
  }
}

function getAfterhoursRow(sessions: Record<string, unknown>): SessionRow | null {
  const s = sessions.AFTERHOURS as Record<string, unknown> | undefined
  if (!s) return null
  return {
    label: 'After-hours',
    serviceCharge: safeNum(s.service_charge),
    rdfMed:        safeNum(s.rdf_medicine_sales),
    lab:           safeNum(s.logistic_sales),
    usgRevenue:    0,
    patients:      safeNum(s.patients),
  }
}

function getSatelliteRows(teams: unknown[]): SessionRow[] {
  return (teams as Array<Record<string, unknown>>).map((t, i) => {
    const usg = Array.isArray(t.usg) ? t.usg as Array<Record<string, unknown>> : []
    return {
      label:         `Satellite — Team ${i + 1}`,
      serviceCharge: safeNum(t.service_charge),
      rdfMed:        safeNum(t.rdf_medicine_sales),
      lab:           safeNum(t.lab_revenue),
      usgRevenue:    usg.reduce((sum, u) => sum + safeNum(u.revenue), 0),
      patients:      safeNum(t.patients_new) + safeNum(t.patients_old),
    }
  })
}

// ── ChannelSection component ──────────────────────────────────────────────────

function ChannelSection({ row }: { row: SessionRow }) {
  const sessionTotal = row.serviceCharge + row.rdfMed + row.lab + row.usgRevenue
  return (
    <div className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-800">{row.label}</p>
        {row.patients !== undefined && row.patients > 0 && (
          <p className="text-xs text-gray-500">{row.patients} patients</p>
        )}
        {row.cases !== undefined && row.cases > 0 && (
          <p className="text-xs text-gray-500">{row.cases} cases</p>
        )}
      </div>
      <span className="text-sm font-semibold text-gray-800 ml-4 text-right">{tk(sessionTotal)}</span>
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ReviewStepProps {
  draftData:   Record<string, unknown>
  openingCash: number
  date:        string
  entityName:  string
  readOnly?:   boolean
  // Wizard mode props (not used in readOnly)
  onSubmit?:   () => void
  onBack?:     () => void
  isSaving?:   boolean
  saveError?:  string | null
}

export default function ReviewStep({
  draftData, openingCash, date, entityName,
  readOnly = false, onSubmit, onBack, isSaving, saveError,
}: ReviewStepProps) {
  const active: string[] = Array.isArray(draftData.channels_active)
    ? draftData.channels_active as string[]
    : []
  const sessions   = (draftData.sessions as Record<string, unknown> | undefined) ?? {}
  const teams      = Array.isArray(draftData.satellite_teams) ? draftData.satellite_teams as unknown[] : []
  const delivery   = (draftData.delivery as Record<string, unknown> | undefined) ?? {}
  const financial  = (draftData.financial as Record<string, unknown> | undefined) ?? {}
  const bankDep    = (financial.bank_deposit as Record<string, unknown> | undefined) ?? {}
  const cashAdv    = (financial.cash_advance as Record<string, unknown> | undefined) ?? {}

  const { total: income, pi: piTotal, rdf: rdfTotal } = computeDraftFundSplit(draftData)
  const advancesReceived = computeAdvancesReceived(draftData)
  const deposit = (bankDep.made === true)
    ? safeNum(bankDep.pi_amount) + safeNum(bankDep.rdf_amount)
    : 0
  const cashInHandCounted = safeNum(financial.cash_in_hand_counted)
  const recon = computeReconciliation({
    openingCash,
    income,
    advancesReceived,
    deposit,
    cashAdvance:       safeNum(cashAdv.amount),
    cashInHandCounted,
  })

  // Per-channel rows (only active channels)
  const channelRows: SessionRow[] = []
  if (active.includes('MORNING')) {
    const r = getSessionRow(sessions, 'MORNING', 'Morning clinic')
    if (r) channelRows.push(r)
  }
  if (active.includes('EVENING')) {
    const r = getSessionRow(sessions, 'EVENING', 'Evening clinic')
    if (r) channelRows.push(r)
  }
  if (active.includes('AFTERHOURS')) {
    const r = getAfterhoursRow(sessions)
    if (r) channelRows.push(r)
  }
  if (active.includes('SATELLITE')) {
    channelRows.push(...getSatelliteRows(teams))
  }

  const nvd      = delivery.nvd as Record<string, unknown> | undefined
  const csection = delivery.csection as Record<string, unknown> | undefined

  const csectionCases    = safeNum(csection?.cases)
  const csectionAdvances = advancesReceived

  return (
    <div className="p-5 space-y-6">
      {/* Headline */}
      <div className="rounded-2xl p-5 text-center" style={{ background: '#07043a' }}>
        <p className="text-white/70 text-sm font-medium">{entityName} · {formatDate(date)}</p>
        <p className="text-white/50 text-xs mt-0.5">Total Revenue Today</p>
        <p className="text-white text-4xl font-bold mt-2">{tk(income)}</p>
        <p className="text-white/50 text-xs mt-1">Computed — matches what will be posted</p>
      </div>

      {/* Section breakdown */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Breakdown</p>

        {channelRows.map((row, i) => (
          <ChannelSection key={i} row={row} />
        ))}

        {active.includes('DELIVERY') && nvd && (
          <div className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0">
            <div>
              <p className="text-sm font-medium text-gray-800">Normal Delivery (NVD)</p>
              {safeNum(nvd.cases) > 0 && (
                <p className="text-xs text-gray-500">{safeNum(nvd.cases)} cases</p>
              )}
            </div>
            <span className="text-sm font-semibold text-gray-800 ml-4">
              {tk(safeNum(nvd.service_charge) + safeNum(nvd.rdf_revenue) + safeNum(nvd.logistic_revenue))}
            </span>
          </div>
        )}

        {active.includes('DELIVERY') && csection && (
          <div className="flex justify-between items-start py-2 last:border-0">
            <div>
              <p className="text-sm font-medium text-gray-800">C-Section</p>
              {csectionCases > 0 && (
                <p className="text-xs text-gray-500">{csectionCases} cases</p>
              )}
              {csectionAdvances > 0 && (
                <p className="text-xs text-amber-700 font-medium">
                  Advance held: {tk(csectionAdvances)} — income at discharge
                </p>
              )}
            </div>
            <span className="text-sm font-semibold text-gray-500 ml-4">—</span>
          </div>
        )}

        {channelRows.length === 0 && !nvd && !csection && (
          <p className="text-sm text-gray-400 py-2">No active channels recorded.</p>
        )}
      </section>

      {/* PI / RDF split */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Fund split</p>
        <div className="flex justify-between py-1">
          <span className="text-sm text-gray-700">PI</span>
          <span className="text-sm font-semibold text-gray-800">{tk(piTotal)}</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-sm text-gray-700">RDF</span>
          <span className="text-sm font-semibold text-gray-800">{tk(rdfTotal)}</span>
        </div>
      </section>

      {/* Cash reconciliation */}
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Cash reconciliation
        </p>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Opening cash</span><span>{tk(openingCash)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>+ Income</span><span>{tk(income)}</span>
          </div>
          {advancesReceived > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>+ C-section advances <span className="text-gray-400 text-xs">(deposit held)</span></span>
              <span>{tk(advancesReceived)}</span>
            </div>
          )}
          {deposit > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>− Bank deposit</span><span>{tk(deposit)}</span>
            </div>
          )}
          {safeNum(cashAdv.amount) > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>− Cash advance</span><span>{tk(safeNum(cashAdv.amount))}</span>
            </div>
          )}
          <div className="border-t border-gray-300 pt-1.5 flex justify-between font-semibold text-gray-800">
            <span>= Expected in hand</span><span>{tk(recon.expectedClosing)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Counted</span><span>{tk(cashInHandCounted)}</span>
          </div>
        </div>
        <div className={`rounded-xl px-3 py-2 text-sm font-semibold mt-1 ${
          recon.matched ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
        }`}>
          {recon.matched
            ? '✓ Count matches expected'
            : `⚠ Off by ${tk(Math.abs(recon.delta))} — discrepancy noted`}
        </div>
        <p className="text-xs text-gray-400">
          Cash from C-section discharges is recorded separately via the discharge bill, not here.
        </p>
      </section>

      {/* Submit / read-only actions */}
      {!readOnly && (
        <div className="space-y-3 pb-4">
          {saveError && (
            <p className="text-red-600 text-sm font-medium" role="alert">{saveError}</p>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSaving}
            className="w-full min-h-[44px] rounded-xl font-bold text-base text-white disabled:opacity-40 transition-opacity"
            style={{ background: '#0b7c3e' }}
          >
            {isSaving ? 'Submitting…' : 'Confirm & Submit →'}
          </button>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="w-full min-h-[44px] rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm"
            >
              ← Back to edit
            </button>
          )}
          <p className="text-xs text-center text-gray-400">
            Submit posts entries to the ledger. Posted entries are immutable.
          </p>
        </div>
      )}

      {readOnly && (
        <div className="rounded-2xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 font-medium text-center">
          ✓ Day submitted — entries posted to ledger
        </div>
      )}
    </div>
  )
}
