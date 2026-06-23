'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { strToMoney, moneyToStr, sanitizeMoney, parseMoneyField } from '@/lib/revenue/money-input'
import { computeBalanceConsequence } from '@/lib/revenue/close-balance'
import { stepKeyDown } from '@/app/(manager)/revenue/wizard/step-key-down'

interface BalanceSummary {
  id:             string
  patient_name:   string
  receipt_no:     string | null
  phone:          string | null
  advance_paid:   number
  admission_date: string
}

interface Props {
  balance:    BalanceSummary
  dhakaToday: string
}

function tk(taka: number): string {
  return 'Tk ' + Math.round(taka).toLocaleString('en-IN')
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function DischargeForm({ balance, dhakaToday }: Props) {
  const router = useRouter()

  // ── String state — no type="number", no blur mutation (T3d law) ──────────
  const [serviceCharge, setServiceCharge] = useState('')
  const [seatRent,      setSeatRent]      = useState('')
  const [rdfAmount,     setRdfAmount]     = useState('')
  const [logistics,     setLogistics]     = useState('')
  // Discharge date defaults to Dhaka-local today (server-derived, avoids UTC-midnight offset)
  const [dischargeDate, setDischargeDate] = useState(dhakaToday)

  const [isSaving,   setIsSaving]   = useState(false)
  const [saveError,  setSaveError]  = useState<string | null>(null)

  // ── Live bill / collect-refund preview ────────────────────────────────────
  const sc      = strToMoney(serviceCharge)
  const seat    = strToMoney(seatRent)
  const rdf     = strToMoney(rdfAmount)
  const log     = strToMoney(logistics)
  const totalBill = sc + seat + rdf + log

  const consequence = computeBalanceConsequence(balance.advance_paid, totalBill)

  const canSubmit = totalBill > 0 && dischargeDate.length === 10 && !isSaving

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!canSubmit) return

    // Save-time validation: reject >2dp before the API call.
    // sanitizeMoney in onChange means this rarely fires, but it's the last line of
    // defence ensuring the system never silently changes the manager's number.
    const billChecks: [string, string][] = [
      ['Service + seat rent', serviceCharge],
      ['Seat rent', seatRent],
      ['Medicines', rdfAmount],
      ['Logistics', logistics],
    ]
    for (const [label, raw] of billChecks) {
      const r = parseMoneyField(raw)
      if (!r.ok) { setSaveError(`${label}: ${r.error}`); return }
    }

    setIsSaving(true)
    setSaveError(null)

    try {
      const res = await fetch('/api/manager/close-balance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryBalanceId: balance.id,
          finalBill: {
            service_charge:   sc,
            seat_rent:        seat,
            rdf_amount:       rdf,
            logistics_amount: log,
          },
          dischargeDate,
        }),
      })

      if (res.ok) {
        // Navigate back to the list; Next.js re-runs the server component with
        // fresh data — the balance now appears in the CLOSED section.
        router.push('/deliveries')
        return
      }

      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setSaveError('This balance has already been closed.')
      } else if (res.status === 403) {
        setSaveError('Access denied — you can only close balances for your own clinic.')
      } else if (res.status === 400) {
        setSaveError(data.error ?? 'Validation error — check the bill amounts.')
      } else {
        setSaveError(data.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setSaveError('Network error — check your connection and try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const inputClass = 'w-full min-h-[44px] rounded-xl border border-gray-300 px-4 text-base bg-white'

  return (
    <div className="min-h-full flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="px-4 pt-5 pb-6"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
      >
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">Discharge</p>
        <h1 className="text-white text-2xl font-bold leading-tight">{balance.patient_name}</h1>
        <p className="text-white/60 text-sm mt-1">
          Admitted {fmtDate(balance.admission_date)} · Advance held {tk(balance.advance_paid)}
        </p>
      </div>

      {/* ── Form ───────────────────────────────────────────────────────────── */}
      <div
        className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 px-4 pt-5 pb-6 space-y-6"
        data-wizard-step
        onKeyDown={stepKeyDown}
      >
        {/* Patient context — read-only */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2 text-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Patient</p>
          {balance.receipt_no && (
            <div className="flex justify-between text-gray-600">
              <span>Receipt / reg. no.</span>
              <span className="font-medium text-gray-800">{balance.receipt_no}</span>
            </div>
          )}
          {balance.phone && (
            <div className="flex justify-between text-gray-600">
              <span>Phone</span>
              <span className="font-medium text-gray-800">{balance.phone}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-600">
            <span>Advance held</span>
            <span className="font-semibold text-gray-800">{tk(balance.advance_paid)}</span>
          </div>
        </section>

        {/* Discharge date */}
        <section className="space-y-2">
          <label className="text-sm font-medium text-gray-700">
            Discharge date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={dischargeDate}
            onChange={e => setDischargeDate(e.target.value)}
            className={inputClass}
          />
        </section>

        {/* Itemized bill */}
        <section className="space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Itemized discharge bill
          </p>

          {/* Service charge — PI, primary income line */}
          <div className="rounded-2xl p-4" style={{ background: '#07043a' }}>
            <label className="block text-sm font-semibold text-white/80 mb-1">
              Service + seat rent (Tk)
              <span className="text-white/50 font-normal text-xs ml-2">→ 4030 PI-C-Section</span>
            </label>
            <input
              type="text" inputMode="decimal" placeholder="0"
              aria-label="Service charge and seat rent"
              value={serviceCharge}
              onChange={e => setServiceCharge(sanitizeMoney(e.target.value))}
              className="w-full min-h-[44px] rounded-xl bg-white/10 border border-white/20 px-4 text-white text-lg font-bold placeholder-white/30"
            />
            {seatRent === '' && (
              <p className="text-white/40 text-xs mt-1">
                Includes service fee + seat rent (both → 4030)
              </p>
            )}
          </div>

          {/* Seat rent — separate line if needed; note it folds into 4030 */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Seat rent (Tk) <span className="text-gray-400 font-normal text-xs">(optional — if entered separately from service charge)</span>
            </label>
            <input
              type="text" inputMode="decimal" placeholder="0"
              value={seatRent}
              onChange={e => setSeatRent(sanitizeMoney(e.target.value))}
              className={inputClass}
            />
          </div>

          {/* RDF medicine — PI/RDF income split */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Medicines / consumables (Tk)
              <span className="text-xs text-gray-400 font-normal ml-1">→ 4110 RDF-Medicine</span>
            </label>
            <input
              type="text" inputMode="decimal" placeholder="0"
              value={rdfAmount}
              onChange={e => setRdfAmount(sanitizeMoney(e.target.value))}
              className={inputClass}
            />
          </div>

          {/* Logistics */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Logistics (Tk)
              <span className="text-xs text-gray-400 font-normal ml-1">→ 4130 RDF-Logistic</span>
            </label>
            <input
              type="text" inputMode="decimal" placeholder="0"
              value={logistics}
              onChange={e => setLogistics(sanitizeMoney(e.target.value))}
              className={inputClass}
            />
          </div>
        </section>

        {/* ── Collect / refund preview ──────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2 text-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Cash consequence
          </p>
          <div className="flex justify-between text-gray-600">
            <span>Total bill</span>
            <span className="font-medium text-gray-800">{tk(totalBill)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Advance held</span>
            <span className="font-medium text-gray-800">{tk(balance.advance_paid)}</span>
          </div>

          {totalBill <= 0 ? (
            <p className="text-xs text-gray-400 italic">
              Enter the bill above to see the collect / refund amount.
            </p>
          ) : (
            <div className={`rounded-xl px-3 py-2 text-sm font-semibold mt-1 ${
              consequence.type === 'collect'
                ? consequence.amount > 0
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-gray-50 text-gray-700 border border-gray-200'
                : 'bg-amber-50 text-amber-800 border border-amber-200'
            }`}>
              {consequence.type === 'collect'
                ? consequence.amount > 0
                  ? `Collect ${tk(consequence.amount)} from patient`
                  : 'Exact match — no additional cash'
                : `Refund ${tk(consequence.amount)} to patient`}
            </div>
          )}
        </section>

        {totalBill <= 0 && (
          <p className="text-red-500 text-xs font-medium -mt-3">
            Total bill must be &gt; 0 to record the discharge.
          </p>
        )}

        {saveError && (
          <p className="text-red-600 text-sm font-medium" role="alert">{saveError}</p>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={!canSubmit}
          className="w-full min-h-[44px] rounded-xl font-semibold text-sm text-white disabled:opacity-40 transition-opacity"
          style={{ background: '#13007D' }}
        >
          {isSaving ? 'Recording discharge…' : 'Record discharge & close'}
        </button>

        <a
          href="/deliveries"
          className="block text-center text-sm font-medium text-gray-400 py-2"
        >
          ← Back to balances
        </a>
      </div>
    </div>
  )
}
