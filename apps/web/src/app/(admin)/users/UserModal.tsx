'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { APP_ROLES, type AppUser, type AppRole, type EntityOption } from './types'

// ── Schemas ───────────────────────────────────────────────────────────────────

const AddSchema = z.object({
  full_name: z.string().min(1, 'Full name is required').max(255, 'Name too long'),
  email:     z.string().email('Valid email required'),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
  role:      z.enum(APP_ROLES),
  entity_id: z.string().nullable(),
}).refine(
  d => (d.role === 'ENTRY') === (d.entity_id !== null && d.entity_id !== ''),
  { message: 'ENTRY users must have an entity; other roles must not', path: ['entity_id'] },
)

const EditSchema = z.object({
  full_name: z.string().min(1, 'Full name is required').max(255, 'Name too long'),
  role:      z.enum(APP_ROLES),
  entity_id: z.string().nullable(),
}).refine(
  d => (d.role === 'ENTRY') === (d.entity_id !== null && d.entity_id !== ''),
  { message: 'ENTRY users must have an entity; other roles must not', path: ['entity_id'] },
)

type AddFields  = 'full_name' | 'email' | 'password' | 'role' | 'entity_id'
type EditFields = 'full_name' | 'role' | 'entity_id'
type FieldErrors = Partial<Record<AddFields, string>>

// ── Form state ────────────────────────────────────────────────────────────────

type FormState = {
  full_name: string
  email:     string
  password:  string
  role:      AppRole
  entity_id: string  // '' means null
  showPw:    boolean
}

// ── DB / route error mapping ──────────────────────────────────────────────────

function mapDbError(err: { code?: string; message?: string }): string {
  const c = err.code ?? ''
  if (c === '42501') return 'Permission denied — only admins can modify users.'
  if (c === '23514') return 'ENTRY users must have an entity; other roles must not.'
  if (c === 'P0001') return err.message ?? 'A database constraint was violated.'
  return (err.message ?? 'An unexpected error occurred.').slice(0, 120)
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputCls = (err?: string) =>
  `w-full px-4 py-3 border rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200 ${
    err ? 'border-red-400 bg-red-50' : 'border-gray-300'
  }`

const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

const ROLE_LABEL: Record<AppRole, string> = {
  ADMIN:      'Admin',
  HQ_FINANCE: 'HQ Finance',
  ENTRY:      'Entry (clinic manager)',
  READ_ONLY:  'Read-only',
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  appUser:  AppUser | null   // null = add mode
  entities: EntityOption[]
  onClose:  () => void
  onSaved:  () => Promise<void>
}

export default function UserModal({ appUser, entities, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isEdit    = appUser !== null

  const [form, setForm] = useState<FormState>({
    full_name: appUser?.full_name ?? '',
    email:     '',
    password:  '',
    role:      appUser?.role ?? 'ENTRY',
    entity_id: appUser?.entity_id ?? '',
    showPw:    false,
  })

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saveError,   setSaveError]   = useState<string | null>(null)
  const [isSaving,    setIsSaving]    = useState(false)

  useEffect(() => { dialogRef.current?.showModal() }, [])

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      // When role changes away from ENTRY, clear entity selection
      if (key === 'role' && value !== 'ENTRY') {
        next.entity_id = ''
      }
      return next
    })
    if (key !== 'showPw') {
      const errKey = key as AddFields
      setFieldErrors(prev => ({ ...prev, [errKey]: undefined }))
      setSaveError(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldErrors({})
    setSaveError(null)

    const entityVal = form.entity_id || null

    if (isEdit) {
      // ── Edit: validate with EditSchema then direct Supabase update ──────────
      const result = EditSchema.safeParse({
        full_name: form.full_name.trim(),
        role:      form.role,
        entity_id: entityVal,
      })

      if (!result.success) {
        const errs: FieldErrors = {}
        result.error.issues.forEach(issue => {
          const key = issue.path[0] as EditFields
          if (!errs[key]) errs[key] = issue.message
        })
        setFieldErrors(errs)
        return
      }

      setIsSaving(true)
      const supabase = createClient()
      const { error: dbErr } = await supabase
        .from('app_users')
        .update({ full_name: result.data.full_name, role: result.data.role, entity_id: result.data.entity_id })
        .eq('id', appUser!.id)
      setIsSaving(false)

      if (dbErr) {
        setSaveError(mapDbError(dbErr))
      } else {
        await onSaved()
      }
      return
    }

    // ── Add: validate with AddSchema then call the server route ───────────────
    const result = AddSchema.safeParse({
      full_name: form.full_name.trim(),
      email:     form.email.trim(),
      password:  form.password,
      role:      form.role,
      entity_id: entityVal,
    })

    if (!result.success) {
      const errs: FieldErrors = {}
      result.error.issues.forEach(issue => {
        const key = issue.path[0] as AddFields
        if (!errs[key]) errs[key] = issue.message
      })
      setFieldErrors(errs)
      return
    }

    setIsSaving(true)
    let res: Response
    try {
      res = await fetch('/api/admin/create-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(result.data),
      })
    } catch {
      setIsSaving(false)
      setSaveError('Network error — could not reach the server.')
      return
    }

    const body = await res.json().catch(() => ({}))
    setIsSaving(false)

    if (!res.ok) {
      setSaveError((body as { error?: string }).error ?? `Unexpected error (HTTP ${res.status})`)
    } else {
      await onSaved()
    }
  }

  const handleClose = () => {
    dialogRef.current?.close()
    onClose()
  }

  const showEntityField = form.role === 'ENTRY'

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
            {isEdit ? `Edit user — ${appUser!.full_name ?? 'unknown'}` : 'Add user'}
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

          {/* Full name */}
          <div>
            <label className={labelCls}>Full name</label>
            <input
              value={form.full_name}
              onChange={e => setField('full_name', e.target.value)}
              className={inputCls(fieldErrors.full_name)}
              placeholder="e.g. Arif Hossain"
              autoFocus={!isEdit}
            />
            {fieldErrors.full_name && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.full_name}</p>
            )}
          </div>

          {/* Email — add mode only */}
          {!isEdit && (
            <div>
              <label className={labelCls}>Email address</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setField('email', e.target.value)}
                className={inputCls(fieldErrors.email)}
                placeholder="e.g. arif@image-bd.org"
                autoComplete="off"
              />
              {fieldErrors.email && (
                <p className="text-xs text-red-500 mt-0.5">{fieldErrors.email}</p>
              )}
            </div>
          )}

          {/* Password — add mode only */}
          {!isEdit && (
            <div>
              <label className={labelCls}>Initial password</label>
              <div className="relative">
                <input
                  type={form.showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setField('password', e.target.value)}
                  className={inputCls(fieldErrors.password) + ' pr-20'}
                  placeholder="Min. 8 characters"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setField('showPw', !form.showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-500 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 rounded px-1 py-0.5"
                >
                  {form.showPw ? 'Hide' : 'Show'}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="text-xs text-red-500 mt-0.5">{fieldErrors.password}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">
                The user can change this after first login.
              </p>
            </div>
          )}

          {/* Role */}
          <div>
            <label className={labelCls}>Role</label>
            <select
              value={form.role}
              onChange={e => setField('role', e.target.value as AppRole)}
              className={inputCls(fieldErrors.role)}
            >
              {APP_ROLES.map(r => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
            {fieldErrors.role && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.role}</p>
            )}
          </div>

          {/* Entity — shown only when role = ENTRY */}
          {showEntityField && (
            <div>
              <label className={labelCls}>Entity (clinic)</label>
              <select
                value={form.entity_id}
                onChange={e => setField('entity_id', e.target.value)}
                className={inputCls(fieldErrors.entity_id)}
              >
                <option value="">— select clinic —</option>
                {entities.map(ent => (
                  <option key={ent.id} value={ent.id}>{ent.code} — {ent.name}</option>
                ))}
              </select>
              {fieldErrors.entity_id && (
                <p className="text-xs text-red-500 mt-0.5">{fieldErrors.entity_id}</p>
              )}
            </div>
          )}

          {/* Email-not-editable note in edit mode */}
          {isEdit && (
            <p className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
              Email and password are managed in Supabase Auth and cannot be changed here.
            </p>
          )}

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
            {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
