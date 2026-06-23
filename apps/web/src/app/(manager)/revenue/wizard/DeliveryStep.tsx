'use client'

import { useState } from 'react'
import type { EntityCapabilities } from '@/lib/capabilities'
import {
  strToMoney, strToInt, moneyToStr,
  sanitizeMoney, sanitizeCount, parseMoneyField,
} from '@/lib/revenue/money-input'
import { validateRequiredText } from '@/lib/revenue/validation'
import { stepKeyDown } from './step-key-down'

// Balance entries hold string display values for numeric fields so the input
// captures exactly what the manager typed (no browser blur reformatting).
interface BalanceEntry {
  receipt_no?:      string
  patient_name:     string
  phone?:           string
  advance:          string   // display string; parsed to number at save
  expected_balance: string   // display string; parsed to number at save
  expected_date?:   string
}

interface NvdNumbers {
  cases:            number
  service_charge:   number
  rdf_revenue:      number
  logistic_revenue: number
}

interface CsectionNumbers {
  cases:    number
  balances: Array<{
    receipt_no?:      string
    patient_name:     string
    phone?:           string
    advance:          number
    expected_balance: number
    expected_date?:   string
  }>
}

function parseNvd(raw: unknown): NvdNumbers {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const d = raw as Record<string, unknown>
    return {
      cases:            typeof d.cases === 'number' ? d.cases : 0,
      service_charge:   typeof d.service_charge === 'number' ? d.service_charge : 0,
      rdf_revenue:      typeof d.rdf_revenue === 'number' ? d.rdf_revenue : 0,
      logistic_revenue: typeof d.logistic_revenue === 'number' ? d.logistic_revenue : 0,
    }
  }
  return { cases: 0, service_charge: 0, rdf_revenue: 0, logistic_revenue: 0 }
}

function parseCsectionToDisplay(raw: unknown): { cases: number; balances: BalanceEntry[] } {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const d = raw as Record<string, unknown>
    const balances: BalanceEntry[] = Array.isArray(d.balances)
      ? (d.balances as Array<Record<string, unknown>>).map(b => ({
          receipt_no:       typeof b.receipt_no === 'string' ? b.receipt_no : undefined,
          patient_name:     typeof b.patient_name === 'string' ? b.patient_name : '',
          phone:            typeof b.phone === 'string' ? b.phone : undefined,
          advance:          moneyToStr(typeof b.advance === 'number' ? b.advance : 0),
          expected_balance: moneyToStr(typeof b.expected_balance === 'number' ? b.expected_balance : 0),
          expected_date:    typeof b.expected_date === 'string' ? b.expected_date : undefined,
        }))
      : [defaultBalance()]
    return { cases: typeof d.cases === 'number' ? d.cases : balances.length, balances }
  }
  return { cases: 1, balances: [defaultBalance()] }
}

function defaultBalance(): BalanceEntry {
  return { patient_name: '', advance: '', expected_balance: '' }
}

interface Props {
  caps:        EntityCapabilities
  initialData: unknown
  onSave:      (slice: unknown) => Promise<void>
  isSaving:    boolean
  saveError:   string | null
}

export default function DeliveryStep({ caps, initialData, onSave, isSaving, saveError }: Props) {
  const initDelivery = (initialData && typeof initialData === 'object' && !Array.isArray(initialData))
    ? (initialData as Record<string, unknown>)
    : {}

  const initNvd = parseNvd(initDelivery.nvd)

  // NVD: individual string state variables (converted to number at save only).
  const [nvdCases,     setNvdCases]     = useState(() => moneyToStr(initNvd.cases))
  const [nvdCharge,    setNvdCharge]    = useState(() => moneyToStr(initNvd.service_charge))
  const [nvdRdf,       setNvdRdf]       = useState(() => moneyToStr(initNvd.rdf_revenue))
  const [nvdLogistic,  setNvdLogistic]  = useState(() => moneyToStr(initNvd.logistic_revenue))

  // C-section: BalanceEntry holds string display values for advance/expected_balance.
  const [csection, setCsection] = useState(() =>
    caps.delivery.csection
      ? parseCsectionToDisplay(initDelivery.csection)
      : { cases: 0, balances: [] as BalanceEntry[] }
  )

  const [fieldError, setFieldError] = useState<string | null>(null)

  const inputClass = 'w-full min-h-[44px] rounded-xl border border-gray-300 px-4 text-base bg-white'

  function updateBalance(idx: number, patch: Partial<BalanceEntry>) {
    // Sanitize money strings inline so comma-separated input is corrected at keystroke
    const sanitized: Partial<BalanceEntry> = { ...patch }
    if (typeof patch.advance === 'string') sanitized.advance = sanitizeMoney(patch.advance)
    if (typeof patch.expected_balance === 'string') sanitized.expected_balance = sanitizeMoney(patch.expected_balance)
    setCsection(prev => {
      const balances = prev.balances.map((b, i) => i === idx ? { ...b, ...sanitized } : b)
      return { ...prev, cases: balances.length, balances }
    })
  }

  function addBalance() {
    setCsection(prev => {
      const balances = [...prev.balances, defaultBalance()]
      return { ...prev, cases: balances.length, balances }
    })
  }

  function removeBalance(idx: number) {
    setCsection(prev => {
      const balances = prev.balances.filter((_, i) => i !== idx)
      return { ...prev, cases: balances.length, balances }
    })
  }

  async function handleSave() {
    setFieldError(null)

    // NVD money validation
    if (caps.delivery.nvd) {
      const nvdChecks: [string, string][] = [
        ['NVD service charge', nvdCharge],
        ['NVD RDF medicine', nvdRdf],
        ['NVD logistics', nvdLogistic],
      ]
      for (const [label, raw] of nvdChecks) {
        const r = parseMoneyField(raw)
        if (!r.ok) { setFieldError(`${label}: ${r.error}`); return }
      }
    }

    // C-section balance validation
    if (caps.delivery.csection) {
      for (let i = 0; i < csection.balances.length; i++) {
        const b = csection.balances[i]
        const nameR = validateRequiredText(b.patient_name, 'Patient name')
        if (!nameR.ok) { setFieldError(`Patient ${i + 1}: ${nameR.error}`); return }
        const advR = parseMoneyField(b.advance)
        if (!advR.ok) { setFieldError(`Patient ${i + 1} advance: ${advR.error}`); return }
        const expR = parseMoneyField(b.expected_balance)
        if (!expR.ok) { setFieldError(`Patient ${i + 1} expected balance: ${expR.error}`); return }
      }
    }

    const delivery: Record<string, unknown> = {}

    if (caps.delivery.nvd) {
      delivery.nvd = {
        cases:            strToInt(nvdCases),
        service_charge:   strToMoney(nvdCharge),
        rdf_revenue:      strToMoney(nvdRdf),
        logistic_revenue: strToMoney(nvdLogistic),
      } satisfies NvdNumbers
    }

    if (caps.delivery.csection) {
      delivery.csection = {
        cases:    csection.cases,
        balances: csection.balances.map(b => ({
          ...b,
          advance:          strToMoney(b.advance),
          expected_balance: strToMoney(b.expected_balance),
        })),
      } satisfies CsectionNumbers
    }

    await onSave(delivery)
  }

  return (
    <div className="p-5 space-y-8" data-wizard-step onKeyDown={stepKeyDown}>
      <h2 className="text-gray-900 text-lg font-bold">Deliveries</h2>

      {/* ── NVD ── */}
      {caps.delivery.nvd && (
        <section className="space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Normal Delivery (NVD){'  '}
            <span className="text-gray-400 font-normal normal-case">same-day income</span>
          </p>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700"># Cases</label>
            <input type="text" inputMode="numeric" placeholder="0"
              value={nvdCases}
              onChange={e => setNvdCases(sanitizeCount(e.target.value))}
              className={inputClass}
            />
          </div>

          <div className="rounded-2xl p-4" style={{ background: '#07043a' }}>
            <label className="block text-sm font-semibold text-white/80 mb-1">
              Service charge (Tk){'  '}
              <span className="text-white/50 font-normal text-xs">→ 4020 PI-NVD</span>
            </label>
            <input type="text" inputMode="decimal" placeholder="0"
              value={nvdCharge}
              onChange={e => setNvdCharge(sanitizeMoney(e.target.value))}
              className="w-full min-h-[44px] rounded-xl bg-white/10 border border-white/20 px-4 text-white text-lg font-bold placeholder-white/30"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              RDF medicine revenue (Tk) <span className="text-xs text-gray-400 font-normal">→ 4110</span>
            </label>
            <input type="text" inputMode="decimal" placeholder="0"
              value={nvdRdf}
              onChange={e => setNvdRdf(sanitizeMoney(e.target.value))}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Logistics revenue (Tk) <span className="text-xs text-gray-400 font-normal">→ 4130</span>
            </label>
            <input type="text" inputMode="decimal" placeholder="0"
              value={nvdLogistic}
              onChange={e => setNvdLogistic(sanitizeMoney(e.target.value))}
              className={inputClass}
            />
          </div>
        </section>
      )}

      {/* ── C-Section ── */}
      {caps.delivery.csection && (
        <section className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">C-Section</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Advance / deposit held — income recognised at discharge
            </p>
          </div>

          {csection.balances.map((b, idx) => (
            <div key={idx} className="rounded-2xl border border-gray-200 p-4 space-y-3 bg-white">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Patient {idx + 1}</p>
                {csection.balances.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBalance(idx)}
                    className="text-red-500 text-xs font-medium min-h-[44px] px-2"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Patient name <span className="text-red-500">*</span></label>
                <input type="text" placeholder="Full name"
                  value={b.patient_name}
                  onChange={e => updateBalance(idx, { patient_name: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Receipt / reg. no. <span className="text-gray-400 font-normal text-xs">(optional)</span></label>
                <input type="text" placeholder="e.g. R-001"
                  value={b.receipt_no ?? ''}
                  onChange={e => updateBalance(idx, { receipt_no: e.target.value || undefined })}
                  className={inputClass}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Phone <span className="text-gray-400 font-normal text-xs">(optional)</span></label>
                <input type="tel" inputMode="tel" placeholder="01XXXXXXXXX"
                  value={b.phone ?? ''}
                  onChange={e => updateBalance(idx, { phone: e.target.value || undefined })}
                  className={inputClass}
                />
              </div>

              {/* Advance — the key cash-in figure; labeled as deposit, NEVER income */}
              <div className="rounded-2xl p-4" style={{ background: '#07043a' }}>
                <label className="block text-sm font-semibold text-white/80 mb-1">
                  Advance / deposit held (Tk)
                  <span className="text-white/50 font-normal text-xs ml-2">Dr 1010 / Cr 2150 — not income</span>
                </label>
                <input type="text" inputMode="decimal" placeholder="0"
                  value={b.advance}
                  onChange={e => updateBalance(idx, { advance: e.target.value })}
                  className="w-full min-h-[44px] rounded-xl bg-white/10 border border-white/20 px-4 text-white text-lg font-bold placeholder-white/30"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">
                  Expected balance (Tk) <span className="text-gray-400 font-normal text-xs">(optional — estimated at admission)</span>
                </label>
                <input type="text" inputMode="decimal" placeholder="0"
                  value={b.expected_balance}
                  onChange={e => updateBalance(idx, { expected_balance: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">
                  Expected discharge date <span className="text-gray-400 font-normal text-xs">(optional)</span>
                </label>
                <input type="date"
                  value={b.expected_date ?? ''}
                  onChange={e => updateBalance(idx, { expected_date: e.target.value || undefined })}
                  className={inputClass}
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addBalance}
            className="w-full min-h-[44px] rounded-xl border-2 border-dashed border-gray-300 text-gray-600 text-sm font-medium"
          >
            + Add another C-section patient
          </button>
        </section>
      )}

      {fieldError && (
        <p className="text-red-600 text-sm font-medium" role="alert">{fieldError}</p>
      )}

      {saveError && (
        <p className="text-red-600 text-sm font-medium" role="alert">{saveError}</p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="w-full min-h-[44px] rounded-xl font-semibold text-sm text-white disabled:opacity-40 transition-opacity"
        style={{ background: '#13007D' }}
      >
        {isSaving ? 'Saving…' : 'Save & Continue →'}
      </button>
    </div>
  )
}
