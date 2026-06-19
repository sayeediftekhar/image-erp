'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { PARTY_KINDS, type Party, type ControlAccount } from './types'

const PartySchema = z.object({
  name:            z.string().min(1, 'Name is required').max(255, 'Name too long'),
  kind:            z.enum(PARTY_KINDS),
  control_account: z.string().nullable(),
  contact:         z.string().max(255, 'Contact too long').nullable(),
  active:          z.boolean(),
})

type PartyForm  = z.infer<typeof PartySchema>
type FieldErrors = Partial<Record<keyof PartyForm, string>>

function mapDbError(err: { code?: string; message?: string }): string {
  const c = err.code ?? ''
  if (c === '42501') return 'Permission denied — only admins can modify parties.'
  if (c === '23503') return 'That control account does not exist.'
  if (c === '23505') return 'A party with that name already exists.'
  if (c === 'P0001') return err.message ?? 'A database constraint was violated.'
  return (err.message ?? 'An unexpected error occurred.').slice(0, 120)
}

interface Props {
  party:           Party | null
  controlAccounts: ControlAccount[]
  onClose:         () => void
  onSaved:         () => Promise<void>
}

const inputCls = (err?: string) =>
  `w-full px-4 py-3 border rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200 ${
    err ? 'border-red-400 bg-red-50' : 'border-gray-300'
  }`

const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

export default function PartyModal({ party, controlAccounts, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isEdit    = party !== null

  const [form, setForm] = useState<PartyForm>({
    name:            party?.name            ?? '',
    kind:            party?.kind            ?? 'VENDOR',
    control_account: party?.control_account ?? null,
    contact:         party?.contact         ?? null,
    active:          party?.active          ?? true,
  })

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saveError,   setSaveError]   = useState<string | null>(null)
  const [isSaving,    setIsSaving]    = useState(false)

  useEffect(() => { dialogRef.current?.showModal() }, [])

  const setField = <K extends keyof PartyForm>(key: K, value: PartyForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setFieldErrors(prev => ({ ...prev, [key]: undefined }))
    setSaveError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldErrors({})
    setSaveError(null)

    // Normalise empty strings → null for optional fields
    const raw = {
      ...form,
      control_account: form.control_account || null,
      contact:         form.contact?.trim() || null,
    }

    const result = PartySchema.safeParse(raw)
    if (!result.success) {
      const errs: FieldErrors = {}
      result.error.issues.forEach(issue => {
        const key = issue.path[0] as keyof PartyForm
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
      // id, created_by, created_at are not updated
      const { ...rest } = data
      const res = await supabase.from('parties').update(rest).eq('id', party!.id)
      dbErr = res.error
    } else {
      const res = await supabase.from('parties').insert(data)
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
            {isEdit ? `Edit party — ${party!.name}` : 'Add party'}
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

          {/* Name */}
          <div>
            <label className={labelCls}>Name</label>
            <input
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              className={inputCls(fieldErrors.name)}
              placeholder="e.g. Renata Ltd"
              autoFocus={!isEdit}
            />
            {fieldErrors.name && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.name}</p>
            )}
          </div>

          {/* Kind */}
          <div>
            <label className={labelCls}>Kind</label>
            <select
              value={form.kind}
              onChange={e => setField('kind', e.target.value as typeof PARTY_KINDS[number])}
              className={inputCls()}
            >
              {PARTY_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>

          {/* Control account */}
          <div>
            <label className={labelCls}>
              Control account{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <select
              value={form.control_account ?? ''}
              onChange={e => setField('control_account', e.target.value || null)}
              className={inputCls()}
            >
              <option value="">— none —</option>
              {controlAccounts.map(a => (
                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>

          {/* Contact */}
          <div>
            <label className={labelCls}>
              Contact{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              value={form.contact ?? ''}
              onChange={e => setField('contact', e.target.value || null)}
              className={inputCls(fieldErrors.contact)}
              placeholder="Email, phone, or notes"
            />
            {fieldErrors.contact && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.contact}</p>
            )}
          </div>

          {/* Active */}
          <div className="pt-1">
            <label className="flex items-center gap-2 text-base text-gray-800 cursor-pointer select-none min-h-[44px]">
              <input
                type="checkbox"
                checked={form.active}
                onChange={e => setField('active', e.target.checked)}
                className="h-4 w-4 rounded accent-navy-vivid"
              />
              Active
            </label>
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
            disabled={isSaving}
            className="min-h-[44px] px-5 text-base rounded-lg bg-navy-vivid text-white font-medium hover:bg-navy-deep focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Add party'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
