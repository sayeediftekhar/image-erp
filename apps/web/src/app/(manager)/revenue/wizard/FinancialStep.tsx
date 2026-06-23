'use client'

import { useState, useMemo } from 'react'
import {
  computeDraftIncome,
  computeAdvancesReceived,
  computeReconciliation,
} from '@/lib/revenue/reconciliation'
import { strToMoney, moneyToStr } from '@/lib/revenue/money-input'
import { stepKeyDown } from './step-key-down'

function tk(v: number): string {
  return 'Tk ' + Math.round(v).toLocaleString('en-IN')
}

function parseInitialData(raw: unknown) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const d = raw as Record<string, unknown>
    const bd = d.bank_deposit as Record<string, unknown> | undefined
    const ca = d.cash_advance as Record<string, unknown> | undefined
    return {
      bankDepositMade:     typeof bd?.made === 'boolean' ? bd.made : false,
      bankDepositPi:       moneyToStr(typeof bd?.pi_amount === 'number' ? bd.pi_amount : 0),
      bankDepositRdf:      moneyToStr(typeof bd?.rdf_amount === 'number' ? bd.rdf_amount : 0),
      cashAdvanceAmount:   moneyToStr(typeof ca?.amount === 'number' ? ca.amount : 0),
      cashAdvanceFund:     (ca?.fund === 'PI' || ca?.fund === 'RDF') ? ca.fund as 'PI' | 'RDF' : null,
      cashAdvanceDesc:     typeof ca?.description === 'string' ? ca.description : '',
      cashInHandCounted:   moneyToStr(typeof d.cash_in_hand_counted === 'number' ? d.cash_in_hand_counted : 0),
      reconciliationNotes: typeof d.reconciliation_notes === 'string' ? d.reconciliation_notes : '',
    }
  }
  return {
    bankDepositMade: false, bankDepositPi: '', bankDepositRdf: '',
    cashAdvanceAmount: '', cashAdvanceFund: null as 'PI' | 'RDF' | null,
    cashAdvanceDesc: '', cashInHandCounted: '', reconciliationNotes: '',
  }
}

interface Props {
  draftData:   Record<string, unknown>
  openingCash: number
  initialData: unknown
  onSave:      (slice: unknown) => Promise<void>
  isSaving:    boolean
  saveError:   string | null
}

export default function FinancialStep({
  draftData, openingCash, initialData, onSave, isSaving, saveError,
}: Props) {
  const init = parseInitialData(initialData)

  // All numeric fields stored as strings — converted to number only at save or reconciliation.
  const [bankDepositMade,     setBankDepositMade]     = useState(init.bankDepositMade)
  const [bankDepositPi,       setBankDepositPi]       = useState(init.bankDepositPi)
  const [bankDepositRdf,      setBankDepositRdf]      = useState(init.bankDepositRdf)
  const [cashAdvanceAmount,   setCashAdvanceAmount]   = useState(init.cashAdvanceAmount)
  const [cashAdvanceFund,     setCashAdvanceFund]     = useState<'PI' | 'RDF' | null>(init.cashAdvanceFund)
  const [cashAdvanceDesc,     setCashAdvanceDesc]     = useState(init.cashAdvanceDesc)
  const [cashInHandCounted,   setCashInHandCounted]   = useState(init.cashInHandCounted)
  const [reconciliationNotes, setReconciliationNotes] = useState(init.reconciliationNotes)
  const [showCashAdvance,     setShowCashAdvance]     = useState(init.cashAdvanceAmount !== '')

  const income           = useMemo(() => computeDraftIncome(draftData), [draftData])
  const advancesReceived = useMemo(() => computeAdvancesReceived(draftData), [draftData])

  // Parse strings to numbers for live reconciliation display.
  const piNum       = strToMoney(bankDepositPi)
  const rdfNum      = strToMoney(bankDepositRdf)
  const deposit     = bankDepositMade ? piNum + rdfNum : 0
  const advanceNum  = strToMoney(cashAdvanceAmount)
  const countedNum  = strToMoney(cashInHandCounted)

  const recon = computeReconciliation({
    openingCash,
    income,
    advancesReceived,
    deposit,
    cashAdvance:       advanceNum,
    cashInHandCounted: countedNum,
  })

  async function handleSave() {
    await onSave({
      bank_deposit: {
        made:       bankDepositMade,
        pi_amount:  piNum,
        rdf_amount: rdfNum,
      },
      cash_advance: {
        amount:      advanceNum,
        fund:        cashAdvanceFund,
        description: cashAdvanceDesc || null,
      },
      cash_in_hand_counted:  countedNum,
      reconciliation_notes:  reconciliationNotes || null,
    })
  }

  const inputClass = 'w-full min-h-[44px] rounded-xl border border-gray-300 px-4 text-base bg-white'

  return (
    <div className="p-5 space-y-8" data-wizard-step onKeyDown={stepKeyDown}>
      <h2 className="text-gray-900 text-lg font-bold">Financial wrap-up</h2>

      {/* ── Bank deposit ── */}
      <section className="space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Bank deposit</p>

        <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            checked={bankDepositMade}
            onChange={e => setBankDepositMade(e.target.checked)}
            className="w-5 h-5 rounded"
          />
          <span className="text-sm font-medium text-gray-700">Bank deposit made today</span>
        </label>

        {bankDepositMade && (
          <div className="space-y-3 pl-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                PI deposited (Tk) <span className="text-xs text-gray-400 font-normal">→ Dr 1110 / Cr 1010</span>
              </label>
              <input type="text" inputMode="decimal" placeholder="0"
                value={bankDepositPi}
                onChange={e => setBankDepositPi(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                RDF deposited (Tk) <span className="text-xs text-gray-400 font-normal">→ Dr 1120 / Cr 1020</span>
              </label>
              <input type="text" inputMode="decimal" placeholder="0"
                value={bankDepositRdf}
                onChange={e => setBankDepositRdf(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        )}
      </section>

      {/* ── Cash advance ── */}
      <section className="space-y-4">
        {!showCashAdvance ? (
          <button
            type="button"
            onClick={() => setShowCashAdvance(true)}
            className="text-sm font-medium min-h-[44px]"
            style={{ color: '#13007D' }}
          >
            + Add cash advance (rare)
          </button>
        ) : (
          <>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cash advance</p>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Amount (Tk)</label>
                <input type="text" inputMode="decimal" placeholder="0"
                  value={cashAdvanceAmount}
                  onChange={e => setCashAdvanceAmount(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Fund</label>
                <select
                  value={cashAdvanceFund ?? ''}
                  onChange={e => setCashAdvanceFund(
                    (e.target.value === 'PI' || e.target.value === 'RDF') ? e.target.value : null,
                  )}
                  className={inputClass}
                >
                  <option value="">Select fund</option>
                  <option value="PI">PI</option>
                  <option value="RDF">RDF</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Description</label>
                <input type="text" placeholder="Purpose of advance"
                  value={cashAdvanceDesc}
                  onChange={e => setCashAdvanceDesc(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Cash in hand ── */}
      <section className="space-y-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cash count</p>
        <div className="rounded-2xl p-4" style={{ background: '#07043a' }}>
          <label className="block text-sm font-semibold text-white/80 mb-1">
            Cash in hand — physical count (Tk)
          </label>
          <input
            type="text" inputMode="decimal" placeholder="0"
            value={cashInHandCounted}
            onChange={e => setCashInHandCounted(e.target.value)}
            className="w-full min-h-[44px] rounded-xl bg-white/10 border border-white/20 px-4 text-white text-lg font-bold placeholder-white/30"
          />
        </div>
      </section>

      {/* ── Reconciliation block ── */}
      <section className="space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Cash reconciliation
        </p>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-2 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Opening cash</span>
            <span>{tk(openingCash)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>+ Income today</span>
            <span>{tk(income)}</span>
          </div>
          {advancesReceived > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>+ C-section advances <span className="text-gray-400 text-xs">(deposit held, not income)</span></span>
              <span>{tk(advancesReceived)}</span>
            </div>
          )}
          {deposit > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>− Bank deposit</span>
              <span>{tk(deposit)}</span>
            </div>
          )}
          {advanceNum > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>− Cash advance</span>
              <span>{tk(advanceNum)}</span>
            </div>
          )}
          <div className="border-t border-gray-300 pt-2 flex justify-between font-semibold text-gray-800">
            <span>= Expected in hand</span>
            <span>{tk(recon.expectedClosing)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Your count</span>
            <span>{tk(countedNum)}</span>
          </div>
          <div className={`rounded-xl px-3 py-2 text-sm font-semibold mt-1 ${
            recon.matched
              ? 'bg-green-50 text-green-800'
              : 'bg-amber-50 text-amber-800'
          }`}>
            {recon.matched
              ? '✓ Matches your count'
              : `⚠ Off by ${tk(Math.abs(recon.delta))} — check your count`}
          </div>
        </div>
        {advancesReceived === 0 && (
          <p className="text-xs text-gray-400">
            If a C-section patient was discharged today, that cash is not included here — record it when you process the discharge bill.
          </p>
        )}
        {advancesReceived > 0 && (
          <p className="text-xs text-gray-400">
            Note: cash from C-section discharges (if any) is not included — record it when you process the discharge bill.
          </p>
        )}
      </section>

      {/* ── Reconciliation notes ── */}
      <section className="space-y-2">
        <label className="text-sm font-medium text-gray-700">
          Reconciliation notes <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          rows={2}
          placeholder="Explain any discrepancy…"
          value={reconciliationNotes}
          onChange={e => setReconciliationNotes(e.target.value)}
          className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base bg-white resize-none"
        />
      </section>

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
