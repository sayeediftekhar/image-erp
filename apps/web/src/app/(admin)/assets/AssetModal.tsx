'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import type { FixedAsset, Entity, AssetClassOption } from './types'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtBDT(amount: number): string {
  return 'Tk ' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// ── Schema (cost is pre-parsed to number before Zod runs) ────────────────────

const AssetSchema = z.object({
  name:          z.string().min(1, 'Name is required').max(255, 'Name too long'),
  entity_id:     z.string().min(1, 'Please select an entity'),
  asset_class:   z.string().min(1, 'Please select an asset class'),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required'),
  cost:          z.number().min(0, 'Cost must be ≥ 0'),
  active:        z.boolean(),
})

type AssetPayload = z.infer<typeof AssetSchema>
type FieldKey     = keyof AssetPayload
type FieldErrors  = Partial<Record<FieldKey, string>>

// ── Form state (costStr = text input; parsed on submit) ───────────────────────

type FormState = {
  name:          string
  entity_id:     string
  asset_class:   string
  purchase_date: string
  costStr:       string
  active:        boolean
}

// ── DB error mapping ──────────────────────────────────────────────────────────

function mapDbError(err: { code?: string; message?: string }): string {
  const c = err.code ?? ''
  if (c === '42501') return 'Permission denied — only admins can modify assets.'
  if (c === '23503') return 'A referenced record (entity or asset class) does not exist.'
  if (c === '23505') return 'A record with that combination already exists.'
  if (c === 'P0001') return err.message ?? 'A database constraint was violated.'
  return (err.message ?? 'An unexpected error occurred.').slice(0, 120)
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputCls = (err?: string) =>
  `w-full px-4 py-3 border rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200 ${
    err ? 'border-red-400 bg-red-50' : 'border-gray-300'
  }`

const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  asset:                   FixedAsset | null
  entities:                Entity[]
  assetClasses:            AssetClassOption[]
  capitalisationThreshold: number | null
  onClose:                 () => void
  onSaved:                 () => Promise<void>
}

export default function AssetModal({
  asset,
  entities,
  assetClasses,
  capitalisationThreshold,
  onClose,
  onSaved,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isEdit    = asset !== null

  const [form, setForm] = useState<FormState>({
    name:          asset?.name          ?? '',
    entity_id:     asset?.entity_id     ?? '',
    asset_class:   asset?.asset_class   ?? '',
    purchase_date: asset?.purchase_date ?? '',
    costStr:       asset != null ? String(asset.cost) : '',
    active:        asset?.active        ?? true,
  })

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saveError,   setSaveError]   = useState<string | null>(null)
  const [isSaving,    setIsSaving]    = useState(false)

  useEffect(() => { dialogRef.current?.showModal() }, [])

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    const errKey = (key === 'costStr' ? 'cost' : key) as FieldKey
    setFieldErrors(prev => ({ ...prev, [errKey]: undefined }))
    setSaveError(null)
  }

  // Live WDV preview while editing cost
  const parsedCost = parseFloat(form.costStr) || 0
  const accumDepr  = asset?.accumulated_depreciation ?? 0
  const liveWDV    = parsedCost - accumDepr

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldErrors({})
    setSaveError(null)

    // Parse cost
    const costNum = Math.round(parseFloat(form.costStr.replace(/,/g, '')) * 100) / 100
    if (isNaN(costNum) || costNum < 0) {
      setFieldErrors({ cost: 'Enter a valid amount ≥ 0' })
      return
    }

    const result = AssetSchema.safeParse({
      name:          form.name.trim(),
      entity_id:     form.entity_id,
      asset_class:   form.asset_class,
      purchase_date: form.purchase_date,
      cost:          costNum,
      active:        form.active,
    })

    if (!result.success) {
      const errs: FieldErrors = {}
      result.error.issues.forEach(issue => {
        const key = issue.path[0] as FieldKey
        if (!errs[key]) errs[key] = issue.message
      })
      setFieldErrors(errs)
      return
    }

    setIsSaving(true)
    const supabase = createClient()
    // accumulated_depreciation is intentionally absent from all payloads
    const { cost, ...rest } = result.data
    const payload: AssetPayload = { ...rest, cost }

    let dbErr: { code?: string; message?: string } | null = null

    if (isEdit) {
      const res = await supabase.from('fixed_assets').update(payload).eq('id', asset!.id)
      dbErr = res.error
    } else {
      const res = await supabase.from('fixed_assets').insert(payload)
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
            {isEdit ? `Edit asset — ${asset!.name}` : 'Add fixed asset'}
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
              placeholder="e.g. X-Ray Machine"
              autoFocus={!isEdit}
            />
            {fieldErrors.name && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.name}</p>
            )}
          </div>

          {/* Entity */}
          <div>
            <label className={labelCls}>Entity (clinic)</label>
            <select
              value={form.entity_id}
              onChange={e => setField('entity_id', e.target.value)}
              className={inputCls(fieldErrors.entity_id)}
            >
              <option value="">— select entity —</option>
              {entities.map(e => (
                <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
              ))}
            </select>
            {fieldErrors.entity_id && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.entity_id}</p>
            )}
          </div>

          {/* Asset class */}
          <div>
            <label className={labelCls}>Asset class</label>
            <select
              value={form.asset_class}
              onChange={e => setField('asset_class', e.target.value)}
              className={inputCls(fieldErrors.asset_class)}
            >
              <option value="">— select class —</option>
              {assetClasses.map(ac => (
                <option key={ac.code} value={ac.code}>{ac.code} — {ac.name}</option>
              ))}
            </select>
            {fieldErrors.asset_class && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.asset_class}</p>
            )}
          </div>

          {/* Purchase date */}
          <div>
            <label className={labelCls}>Purchase date</label>
            <input
              type="date"
              value={form.purchase_date}
              onChange={e => setField('purchase_date', e.target.value)}
              className={inputCls(fieldErrors.purchase_date)}
            />
            {fieldErrors.purchase_date && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.purchase_date}</p>
            )}
          </div>

          {/* Cost */}
          <div>
            <label className={labelCls}>Cost (Tk)</label>
            <input
              type="text"
              inputMode="decimal"
              value={form.costStr}
              onChange={e => setField('costStr', e.target.value)}
              className={inputCls(fieldErrors.cost)}
              placeholder="e.g. 50000"
            />
            {fieldErrors.cost && (
              <p className="text-xs text-red-500 mt-0.5">{fieldErrors.cost}</p>
            )}
            {/* Capitalisation threshold hint — informational only, never blocks save */}
            {capitalisationThreshold !== null && parsedCost > 0 && parsedCost < capitalisationThreshold && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-1">
                Below the Tk {capitalisationThreshold.toLocaleString()} capitalisation threshold — is this an asset or an expense?
              </p>
            )}
          </div>

          {/* Accumulated depreciation — read-only in edit mode */}
          {isEdit && (
            <>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Accumulated depreciation
                </p>
                <p className="font-mono text-base text-gray-700">{fmtBDT(accumDepr)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Set by the depreciation run (Phase 4) — not hand-entered.
                </p>
              </div>

              <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Written-down value
                </p>
                <p className="font-mono text-base text-gray-700">{fmtBDT(liveWDV)}</p>
                <p className="text-xs text-gray-400 mt-1">Cost minus accumulated depreciation</p>
              </div>
            </>
          )}

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
            {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Add asset'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
