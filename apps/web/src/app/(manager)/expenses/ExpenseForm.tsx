'use client'

import { useMemo, useState } from 'react'
import {
  type ExpenseFund,
  type ExpenseSource,
  PI_CATEGORIES,
  RDF_STREAMS,
  deriveRoutedAccount,
  deriveSourceAccount,
  deriveTransferCashAccount,
  getSourceOptions,
} from '@/lib/expense/routing'
import { sanitizeMoney, parseMoneyField } from '@/lib/revenue/money-input'

type PaymentMethod = 'PETTY_CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'CASH'

interface Props {
  entityId:   string
  entityName: string
  userId:     string
}

interface FieldErrors {
  selectionKey?: string
  source?:       string
  amount?:       string
  purchaseDate?: string
  vendor?:       string
  voucherNumber?: string
  chequeNumber?: string
}

interface PostResult {
  entryId: string
  status:  'POSTED' | 'PENDING_APPROVAL'
}

export default function ExpenseForm({ entityName }: Props) {
  // ── Fund-first state ───────────────────────────────────────────────────────
  const [fund, setFund] = useState<ExpenseFund>('PI')
  // Reset all fund-dependent selections when fund changes
  const [selectionKey, setSelectionKey] = useState('')
  const [source, setSource] = useState<ExpenseSource>('PETTY_CASH')

  // ── Audit-chain state ──────────────────────────────────────────────────────
  const [amount, setAmount]           = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [vendor, setVendor]           = useState('')
  const [voucherNumber, setVoucherNumber] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PETTY_CASH')
  const [chequeNumber, setChequeNumber] = useState('')
  const [note, setNote]               = useState('')

  // ── UI state ───────────────────────────────────────────────────────────────
  const [errors, setErrors]     = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult]     = useState<PostResult | null>(null)

  // ── Derived accounts (memoized — pure function of fund + selection) ────────
  const routedAccount = useMemo(
    () => deriveRoutedAccount(fund, selectionKey),
    [fund, selectionKey],
  )

  const sourceAccount = useMemo(() => {
    if (fund === 'TRANSFER') {
      return source === 'BANK' || source === 'CASH'
        ? deriveTransferCashAccount(source as 'BANK' | 'CASH')
        : null
    }
    return deriveSourceAccount(fund as 'PI' | 'RDF', source)
  }, [fund, source])

  // ── Routing display (Dr/Cr sides depend on Transfer direction) ─────────────
  const debitCode  = fund === 'TRANSFER' && selectionKey === 'RECEIVE' ? sourceAccount : routedAccount
  const creditCode = fund === 'TRANSFER' && selectionKey === 'RECEIVE' ? routedAccount : sourceAccount

  // ── Helpers ────────────────────────────────────────────────────────────────
  function handleFundChange(f: ExpenseFund) {
    setFund(f)
    setSelectionKey('')  // reset — Law-6: clearing selection prevents stale 5xxx account surviving fund-switch
    setErrors({})
    setSubmitError(null)
    // Reset source to a valid default for the new fund
    setSource(f === 'TRANSFER' ? 'BANK' : 'PETTY_CASH')
  }

  function today() {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Dhaka',
    })
  }

  function validate(): FieldErrors {
    const e: FieldErrors = {}
    if (!selectionKey) {
      e.selectionKey = fund === 'PI'
        ? 'Select a budget category'
        : fund === 'RDF'
          ? 'Select an RDF stream'
          : 'Select send or receive'
    }
    if (!source) e.source = 'Select source of funds'

    const parsedAmount = parseMoneyField(amount)
    if (!parsedAmount.ok) e.amount = parsedAmount.error
    else if (parsedAmount.value <= 0) e.amount = 'Amount must be greater than 0'

    if (!purchaseDate) e.purchaseDate = 'Purchase date is required'
    else if (purchaseDate > today()) e.purchaseDate = 'Purchase date cannot be in the future'

    if (!vendor.trim()) e.vendor = 'Vendor is required'
    if (!voucherNumber.trim()) e.voucherNumber = 'Voucher # is required'
    if (paymentMethod === 'CHEQUE' && !chequeNumber.trim()) {
      e.chequeNumber = 'Cheque # is required when paying by cheque'
    }
    return e
  }

  async function handleSubmit() {
    const e = validate()
    if (Object.keys(e).length > 0) {
      setErrors(e)
      return
    }
    setErrors({})
    setSubmitError(null)

    const parsedAmount = parseMoneyField(amount)
    if (!parsedAmount.ok || parsedAmount.value <= 0) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/manager/post-expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fund,
          selectionKey,
          source,
          amount: parsedAmount.value,
          purchaseDate,
          paymentDate: paymentDate || undefined,
          vendor: vendor.trim(),
          voucherNumber: voucherNumber.trim(),
          paymentMethod,
          chequeNumber: paymentMethod === 'CHEQUE' ? chequeNumber.trim() : undefined,
          note: note.trim() || undefined,
        }),
      })

      const data = await res.json().catch(() => ({})) as { entryId?: string; status?: string; error?: string }

      if (res.ok && data.entryId) {
        setResult({ entryId: data.entryId, status: data.status as PostResult['status'] })
      } else {
        setSubmitError(data.error ?? 'Failed to post expense — please try again')
      }
    } catch {
      setSubmitError('Network error — check your connection and try again')
    } finally {
      setSubmitting(false)
    }
  }

  function handlePostAnother() {
    setFund('PI')
    setSelectionKey('')
    setSource('PETTY_CASH')
    setAmount('')
    setPurchaseDate('')
    setPaymentDate('')
    setVendor('')
    setVoucherNumber('')
    setPaymentMethod('PETTY_CASH')
    setChequeNumber('')
    setNote('')
    setErrors({})
    setSubmitError(null)
    setResult(null)
  }

  const sourceOptions = getSourceOptions(fund)

  // ── Success screen ─────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 px-4 py-8 flex flex-col items-center gap-6">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: '#13007D' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <div className="text-center space-y-1">
          <p className="text-gray-900 font-semibold text-lg">Expense posted</p>
          {result.status === 'PENDING_APPROVAL' && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Status: Pending approval — an admin or finance officer will review this entry.
            </p>
          )}
          {result.status === 'POSTED' && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Status: Posted to ledger
            </p>
          )}
          <p className="text-xs text-gray-400 pt-1 break-all">Entry ID: {result.entryId}</p>
        </div>

        <button
          onClick={handlePostAnother}
          className="w-full max-w-xs min-h-[44px] rounded-xl font-semibold text-sm text-white"
          style={{ background: '#13007D' }}
        >
          Post another expense
        </button>
      </div>
    )
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 overflow-y-auto">
      <div className="px-4 py-5 space-y-4 pb-8">

        {/* Clinic context */}
        <p className="text-xs text-gray-400 font-medium">{entityName}</p>

        {/* ── Fund selector ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Fund</p>
          <div className="flex gap-2">
            {(['PI', 'RDF', 'TRANSFER'] as const).map((f) => (
              <button
                key={f}
                onClick={() => handleFundChange(f)}
                className={`flex-1 min-h-[40px] rounded-lg text-sm font-semibold border transition-colors ${
                  fund === f
                    ? 'text-white border-transparent'
                    : 'text-gray-600 border-gray-200 bg-white hover:bg-gray-50'
                }`}
                style={fund === f ? { background: '#13007D' } : {}}
              >
                {f === 'PI' ? 'PI' : f === 'RDF' ? 'RDF' : 'Transfer'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            {fund === 'PI'
              ? 'Operating expense → 5000-series account'
              : fund === 'RDF'
                ? 'Stock purchase → 12xx asset account (never a 5xxx expense)'
                : 'Inter-entity movement → 1410/2210 (goes to Pending Approval)'}
          </p>
        </div>

        {/* ── Category / stream / direction ─────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
          {fund === 'PI' && (
            <>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Budget Category
              </label>
              <select
                value={selectionKey}
                onChange={(e) => { setSelectionKey(e.target.value); setErrors((prev) => ({ ...prev, selectionKey: undefined })) }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="">— Select category —</option>
                {PI_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </>
          )}

          {fund === 'RDF' && (
            <>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                RDF Stream
              </label>
              <select
                value={selectionKey}
                onChange={(e) => { setSelectionKey(e.target.value); setErrors((prev) => ({ ...prev, selectionKey: undefined })) }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="">— Select stream —</option>
                {RDF_STREAMS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </>
          )}

          {fund === 'TRANSFER' && (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Direction</p>
              <div className="flex gap-2">
                {(['SEND', 'RECEIVE'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => { setSelectionKey(d); setErrors((prev) => ({ ...prev, selectionKey: undefined })) }}
                    className={`flex-1 min-h-[40px] rounded-lg text-sm font-semibold border transition-colors ${
                      selectionKey === d
                        ? 'text-white border-transparent'
                        : 'text-gray-600 border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                    style={selectionKey === d ? { background: '#13007D' } : {}}
                  >
                    {d === 'SEND' ? 'Send to HQ/clinic' : 'Receive from HQ/clinic'}
                  </button>
                ))}
              </div>
            </>
          )}

          {errors.selectionKey && (
            <p className="text-xs text-red-600" role="alert">{errors.selectionKey}</p>
          )}

          {/* Derived routing display */}
          {debitCode && creditCode && (
            <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 space-y-0.5">
              <p className="text-xs font-mono text-gray-600">Dr {debitCode}</p>
              <p className="text-xs font-mono text-gray-600">Cr {creditCode}</p>
            </div>
          )}
        </div>

        {/* ── Source of funds ────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Source of Funds
          </label>
          <div className="flex flex-col gap-2">
            {sourceOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => { setSource(opt.key as ExpenseSource); setErrors((prev) => ({ ...prev, source: undefined })) }}
                className={`w-full min-h-[40px] rounded-lg text-sm font-medium border text-left px-3 transition-colors ${
                  source === opt.key
                    ? 'text-white border-transparent'
                    : 'text-gray-700 border-gray-200 bg-white hover:bg-gray-50'
                }`}
                style={source === opt.key ? { background: '#13007D' } : {}}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {errors.source && <p className="text-xs text-red-600" role="alert">{errors.source}</p>}
        </div>

        {/* ── Amount ─────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
          <label htmlFor="expense-amount" className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Amount (Tk)
          </label>
          <input
            id="expense-amount"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 1500"
            value={amount}
            onChange={(e) => {
              setAmount(sanitizeMoney(e.target.value))
              setErrors((prev) => ({ ...prev, amount: undefined }))
            }}
            className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              errors.amount ? 'border-red-400' : 'border-gray-300'
            }`}
          />
          {errors.amount && <p className="text-xs text-red-600" role="alert">{errors.amount}</p>}
        </div>

        {/* ── Audit chain ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Audit Details</p>

          {/* Purchase date */}
          <div>
            <label htmlFor="purchase-date" className="block text-xs text-gray-500 mb-1.5">
              Purchase Date <span className="text-red-500">*</span>
            </label>
            <input
              id="purchase-date"
              type="date"
              value={purchaseDate}
              max={today()}
              onChange={(e) => { setPurchaseDate(e.target.value); setErrors((prev) => ({ ...prev, purchaseDate: undefined })) }}
              className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                errors.purchaseDate ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.purchaseDate && <p className="text-xs text-red-600 mt-1" role="alert">{errors.purchaseDate}</p>}
          </div>

          {/* Vendor */}
          <div>
            <label htmlFor="vendor" className="block text-xs text-gray-500 mb-1.5">
              Vendor / Payee <span className="text-red-500">*</span>
            </label>
            <input
              id="vendor"
              type="text"
              placeholder="Supplier or payee name"
              value={vendor}
              onChange={(e) => { setVendor(e.target.value); setErrors((prev) => ({ ...prev, vendor: undefined })) }}
              className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                errors.vendor ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.vendor && <p className="text-xs text-red-600 mt-1" role="alert">{errors.vendor}</p>}
          </div>

          {/* Voucher # */}
          <div>
            <label htmlFor="voucher-number" className="block text-xs text-gray-500 mb-1.5">
              Voucher # <span className="text-red-500">*</span>
            </label>
            <input
              id="voucher-number"
              type="text"
              placeholder="e.g. V-2026-001"
              value={voucherNumber}
              onChange={(e) => { setVoucherNumber(e.target.value); setErrors((prev) => ({ ...prev, voucherNumber: undefined })) }}
              className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                errors.voucherNumber ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.voucherNumber && <p className="text-xs text-red-600 mt-1" role="alert">{errors.voucherNumber}</p>}
          </div>

          {/* Payment method */}
          <div>
            <label htmlFor="payment-method" className="block text-xs text-gray-500 mb-1.5">
              Payment Method
            </label>
            <select
              id="payment-method"
              value={paymentMethod}
              onChange={(e) => {
                setPaymentMethod(e.target.value as PaymentMethod)
                if (e.target.value !== 'CHEQUE') {
                  setChequeNumber('')
                  setErrors((prev) => ({ ...prev, chequeNumber: undefined }))
                }
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="PETTY_CASH">Petty Cash</option>
              <option value="CHEQUE">Cheque</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="CASH">Cash</option>
            </select>
          </div>

          {/* Cheque # — shown only when payment method = Cheque */}
          {paymentMethod === 'CHEQUE' && (
            <div>
              <label htmlFor="cheque-number" className="block text-xs text-gray-500 mb-1.5">
                Cheque # <span className="text-red-500">*</span>
              </label>
              <input
                id="cheque-number"
                type="text"
                placeholder="e.g. 001234"
                value={chequeNumber}
                onChange={(e) => { setChequeNumber(e.target.value); setErrors((prev) => ({ ...prev, chequeNumber: undefined })) }}
                className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  errors.chequeNumber ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              {errors.chequeNumber && <p className="text-xs text-red-600 mt-1" role="alert">{errors.chequeNumber}</p>}
            </div>
          )}

          {/* Payment date (optional) */}
          <div>
            <label htmlFor="payment-date" className="block text-xs text-gray-500 mb-1.5">
              Payment Date <span className="text-gray-400">(optional — defaults to purchase date)</span>
            </label>
            <input
              id="payment-date"
              type="date"
              value={paymentDate}
              max={today()}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Note (optional) */}
          <div>
            <label htmlFor="note" className="block text-xs text-gray-500 mb-1.5">
              Note <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="note"
              rows={2}
              placeholder="Additional context"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
        </div>

        {/* ── Submit ─────────────────────────────────────────────────────── */}
        {submitError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
            {submitError}
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full min-h-[48px] rounded-xl font-semibold text-sm text-white disabled:opacity-40 transition-opacity"
          style={{ background: '#13007D' }}
        >
          {submitting ? 'Posting…' : 'Post Expense'}
        </button>

      </div>
    </div>
  )
}
