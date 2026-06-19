'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { ACCOUNT_TYPES, NORMAL_BALANCES, FUNDS, type Account } from './types'

// ── Zod schema (client-side validation before any DB call) ────────────────────

const AccountSchema = z.object({
  code: z
    .string()
    .min(3, 'Code must be 3–12 characters')
    .max(12, 'Code must be 3–12 characters')
    .regex(/^[A-Z0-9]+$/, 'Uppercase letters and digits only (e.g. 1110)'),
  name:              z.string().min(1, 'Name is required').max(255, 'Name too long'),
  type:              z.enum(ACCOUNT_TYPES),
  normal_balance:    z.enum(NORMAL_BALANCES),
  fund:              z.enum(FUNDS).nullable(),
  is_control:        z.boolean(),
  requires_approval: z.boolean(),
  active:            z.boolean(),
})

type AccountForm  = z.infer<typeof AccountSchema>
type FieldErrors  = Partial<Record<keyof AccountForm, string>>

// ── DB error mapping ──────────────────────────────────────────────────────────

function mapDbError(err: { code?: string; message?: string }): string {
  const c = err.code ?? ''
  // RLS write rejection (permission denied)
  if (c === '42501') return 'Permission denied — only admins can modify accounts.'
  // Unique violation (duplicate code)
  if (c === '23505') return 'An account with that code already exists.'
  // RAISE EXCEPTION from the lock trigger (type/normal_balance locked once used)
  if (c === 'P0001') return err.message ?? 'A database constraint was violated.'
  // Anything else: truncate to 120 chars so nothing cryptic overflows the modal
  return (err.message ?? 'An unexpected error occurred.').slice(0, 120)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  account:  Account | null   // null = ADD mode; Account = EDIT mode
  onClose:  () => void
  onSaved:  () => Promise<void>
}

const inputCls = (err?: string) =>
  `w-full px-4 py-3 border rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200 ${
    err ? 'border-red-400 bg-red-50' : 'border-gray-300'
  }`

const lockedCls =
  'w-full px-4 py-3 border border-gray-200 rounded-lg text-base bg-gray-100 text-gray-500 cursor-not-allowed'

const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

export default function AccountModal({ account, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isEdit    = account !== null

  // Form state — initialise from account (edit) or defaults (add)
  const [form, setForm] = useState<AccountForm>({
    code:              account?.code              ?? '',
    name:              account?.name              ?? '',
    type:              account?.type              ?? 'ASSET',
    normal_balance:    account?.normal_balance    ?? 'DEBIT',
    fund:              account?.fund              ?? null,
    is_control:        account?.is_control        ?? false,
    requires_approval: account?.requires_approval ?? false,
    active:            account?.active            ?? true,
  })

  const [fieldErrors,    setFieldErrors]    = useState<FieldErrors>({})
  const [saveError,      setSaveError]      = useState<string | null>(null)
  const [isSaving,       setIsSaving]       = useState(false)
  const [isCheckingUsed, setIsCheckingUsed] = useState(isEdit)
  const [isUsed,         setIsUsed]         = useState(false)

  // Open the native modal dialog
  useEffect(() => { dialogRef.current?.showModal() }, [])

  // For edit mode: query whether any journal_lines reference this account code.
  // Result drives the locked type/normal_balance fields (T4 trigger enforces this
  // at the DB; the UI surfaces WHY rather than a cryptic constraint violation).
  useEffect(() => {
    if (!isEdit || !account?.code) return
    const supabase = createClient()
    supabase
      .from('journal_lines')
      .select('*', { count: 'exact', head: true })
      .eq('account_code', account.code)
      .then(({ count }) => {
        setIsUsed((count ?? 0) > 0)
        setIsCheckingUsed(false)
      })
  }, [isEdit, account?.code])

  const setField = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setFieldErrors(prev => ({ ...prev, [key]: undefined }))
    setSaveError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldErrors({})
    setSaveError(null)

    const result = AccountSchema.safeParse(form)
    if (!result.success) {
      const errs: FieldErrors = {}
      result.error.issues.forEach(issue => {
        const key = issue.path[0] as keyof AccountForm
        if (!errs[key]) errs[key] = issue.message
      })
      setFieldErrors(errs)
      return
    }

    setIsSaving(true)
    const supabase = createClient()
    const data     = result.data

    let dbErr: { code?: string; message?: string } | null = null

    if (isEdit) {
      // code is the PK and an FK in journal_lines — cannot rename it
      const { code: _unused, ...rest } = data
      const res = await supabase.from('accounts').update(rest).eq('code', account!.code)
      dbErr = res.error
    } else {
      const res = await supabase.from('accounts').insert(data)
      dbErr = res.error
    }

    setIsSaving(false)
    if (dbErr) {
      setSaveError(mapDbError(dbErr))
    } else {
      await onSaved()
    }
  }

  const handleClose = () => {
    dialogRef.current?.close()
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="w-[calc(100vw-2rem)] max-w-lg rounded-xl shadow-2xl p-0 overflow-hidden"
    >
      <form onSubmit={handleSubmit} noValidate>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? `Edit account · ${account!.code}` : 'Add account'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="w-11 h-11 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto bg-white">

          {/* Code */}
          <div>
            <label className={labelCls}>Code</label>
            {isEdit ? (
              <input value={form.code} disabled className={lockedCls} />
            ) : (
              <>
                <input
                  value={form.code}
                  onChange={e => setField('code', e.target.value.toUpperCase())}
                  className={inputCls(fieldErrors.code)}
                  placeholder="e.g. 1110"
                  maxLength={12}
                  autoFocus
                />
                {fieldErrors.code && (
                  <p className="text-xs text-red-500 mt-0.5">{fieldErrors.code}</p>
                )}
              </>
            )}
          </div>

          {/* Name */}
          <div>
            <label className={labelCls}>Name</label>
            <input
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              className={inputCls(fieldErrors.name)}
              placeholder="Account name"
            />
            {fieldErrors.name && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.name}</p>
            )}
          </div>

          {/* Lock notice (edit mode — account has transactions) */}
          {isEdit && isCheckingUsed && (
            <p className="text-xs text-gray-400 italic">Checking transaction history…</p>
          )}
          {isEdit && !isCheckingUsed && isUsed && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
              <strong>Locked —</strong> this account has journal entries. Type and normal
              balance cannot be changed. (Enforced by the DB; changing either would
              invalidate historical postings.)
            </div>
          )}

          {/* Type + Normal Balance */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Type</label>
              <select
                value={form.type}
                onChange={e => setField('type', e.target.value as typeof ACCOUNT_TYPES[number])}
                disabled={isUsed}
                className={isUsed ? lockedCls : inputCls()}
              >
                {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Normal balance</label>
              <select
                value={form.normal_balance}
                onChange={e => setField('normal_balance', e.target.value as typeof NORMAL_BALANCES[number])}
                disabled={isUsed}
                className={isUsed ? lockedCls : inputCls()}
              >
                {NORMAL_BALANCES.map(nb => <option key={nb} value={nb}>{nb}</option>)}
              </select>
            </div>
          </div>

          {/* Fund */}
          <div>
            <label className={labelCls}>
              Fund{' '}
              <span className="text-gray-400 font-normal">(blank = any / cross-fund)</span>
            </label>
            <select
              value={form.fund ?? ''}
              onChange={e =>
                setField('fund', e.target.value === '' ? null : e.target.value as typeof FUNDS[number])
              }
              className={inputCls()}
            >
              <option value="">— any / cross-fund —</option>
              {FUNDS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {/* Checkboxes */}
          <div className="space-y-2 pt-1">
            {(
              [
                { key: 'is_control',        label: 'Control account'    },
                { key: 'requires_approval', label: 'Requires approval'  },
                { key: 'active',            label: 'Active'              },
              ] as const
            ).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-base text-gray-800 cursor-pointer select-none min-h-[44px]">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={e => setField(key, e.target.checked)}
                  className="h-4 w-4 rounded accent-navy-vivid"
                />
                {label}
              </label>
            ))}
          </div>

          {/* Save error */}
          {saveError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              {saveError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] px-5 text-base border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-700 font-medium focus:outline-none focus:ring-4 focus:ring-gray-200 transition-all duration-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || isCheckingUsed}
            className="min-h-[44px] px-5 text-base rounded-lg bg-navy-vivid text-white font-medium hover:bg-navy-deep focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Add account'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
