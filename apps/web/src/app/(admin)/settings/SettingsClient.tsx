'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SETTING_META, type Setting, type AssetClass } from './types'

// ── DB error mapping ──────────────────────────────────────────────────────────

function mapDbError(err: { code?: string; message?: string }): string {
  const c = err.code ?? ''
  if (c === '42501') return 'Permission denied — only admins can change settings.'
  if (c === 'P0001') return err.message ?? 'A database constraint was violated.'
  return (err.message ?? 'An unexpected error occurred.').slice(0, 120)
}

// ── Editing state (one item open at a time) ───────────────────────────────────

type EditingState =
  | { type: 'setting';    key: string;  draft: string; saving: boolean; error: string | null }
  | { type: 'assetClass'; code: string; draftRate: string; draftLife: string; saving: boolean; error: string | null }
  | null

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsClient({
  initialSettings,
  initialAssetClasses,
}: {
  initialSettings:    Setting[]
  initialAssetClasses: AssetClass[]
}) {
  const [settings,     setSettings]     = useState<Setting[]>(initialSettings)
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>(initialAssetClasses)
  const [editing,      setEditing]      = useState<EditingState>(null)

  // ── Scalar setting save ───────────────────────────────────────────────────

  const openSettingEdit = (s: Setting) => {
    setEditing({ type: 'setting', key: s.key, draft: String(s.value), saving: false, error: null })
  }

  const saveSetting = async () => {
    if (editing?.type !== 'setting') return
    const { key, draft } = editing
    const meta = SETTING_META[key]

    const parsed = Number(draft)
    if (isNaN(parsed)) {
      setEditing(e => e && { ...e, error: 'Must be a number.' })
      return
    }
    // Round to integer for threshold/month values (all current settings are integers)
    const intVal = Math.round(parsed)
    const validErr = meta?.validate(intVal)
    if (validErr) {
      setEditing(e => e && { ...e, error: validErr })
      return
    }

    setEditing(e => e && { ...e, saving: true, error: null })
    const supabase = createClient()
    const { error: dbErr } = await supabase
      .from('settings')
      .update({ value: intVal })
      .eq('key', key)

    if (dbErr) {
      setEditing(e => e && { ...e, saving: false, error: mapDbError(dbErr) })
    } else {
      setSettings(prev => prev.map(s => s.key === key ? { ...s, value: intVal } : s))
      setEditing(null)
    }
  }

  // ── Asset class save ──────────────────────────────────────────────────────

  const openAssetEdit = (ac: AssetClass) => {
    setEditing({
      type:      'assetClass',
      code:      ac.code,
      draftRate: (ac.annual_rate * 100).toFixed(2),
      draftLife: String(ac.useful_life_years),
      saving:    false,
      error:     null,
    })
  }

  const saveAssetClass = async () => {
    if (editing?.type !== 'assetClass') return
    const { code, draftRate, draftLife } = editing

    const pct  = parseFloat(draftRate)
    const life = parseInt(draftLife, 10)

    if (isNaN(pct) || pct <= 0 || pct > 100) {
      setEditing(e => e && { ...e, error: 'Rate must be between 0.01% and 100%.' })
      return
    }
    if (!Number.isInteger(life) || life <= 0) {
      setEditing(e => e && { ...e, error: 'Useful life must be a positive whole number of years.' })
      return
    }

    // Convert % → fraction, 4 decimal places — avoids float drift
    const fraction = parseFloat((pct / 100).toFixed(4))

    setEditing(e => e && { ...e, saving: true, error: null })
    const supabase = createClient()
    const { error: dbErr } = await supabase
      .from('asset_classes')
      .update({ annual_rate: fraction, useful_life_years: life })
      .eq('code', code)

    if (dbErr) {
      setEditing(e => e && { ...e, saving: false, error: mapDbError(dbErr) })
    } else {
      setAssetClasses(prev =>
        prev.map(ac => ac.code === code ? { ...ac, annual_rate: fraction, useful_life_years: life } : ac)
      )
      setEditing(null)
    }
  }

  const cancel = () => setEditing(null)

  // ── Input class helpers ───────────────────────────────────────────────────

  const inputCls = 'w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200'
  const smallInputCls = 'w-28 px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200'

  const SaveCancelRow = ({ onSave, saving }: { onSave: () => void; saving: boolean }) => (
    <div className="flex gap-2 mt-3">
      <button
        onClick={onSave}
        disabled={saving}
        className="min-h-[44px] px-5 text-base rounded-lg bg-navy-vivid text-white font-medium hover:bg-navy-deep focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 disabled:opacity-50 transition-all duration-200"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        onClick={cancel}
        disabled={saving}
        className="min-h-[44px] px-5 text-base border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-700 font-medium focus:outline-none focus:ring-4 focus:ring-gray-200 transition-all duration-200"
      >
        Cancel
      </button>
    </div>
  )

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── Section 1: Scalar settings ────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4">System settings</h2>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
          {settings.map(s => {
            const meta    = SETTING_META[s.key]
            const isEditing = editing?.type === 'setting' && editing.key === s.key

            return (
              <div key={s.key} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-medium text-gray-900">
                        {meta?.label ?? s.key}
                      </p>
                      {meta?.provisional && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-900 whitespace-nowrap">
                          PROVISIONAL
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{meta?.description ?? s.key}</p>
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-base font-semibold text-gray-900 tabular-nums">
                        {s.value.toLocaleString()}
                      </span>
                      <button
                        onClick={() => openSettingEdit(s)}
                        className="min-h-[44px] px-4 text-sm font-medium text-navy-vivid border border-navy-vivid/30 rounded-lg hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>

                {isEditing && editing.type === 'setting' && (
                  <div className="mt-3">
                    <input
                      type="number"
                      value={editing.draft}
                      onChange={e => setEditing(prev => prev && { ...prev, draft: e.target.value })}
                      className={inputCls}
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') saveSetting() }}
                    />
                    {editing.error && (
                      <p className="text-sm text-red-800 mt-1">{editing.error}</p>
                    )}
                    <SaveCancelRow onSave={saveSetting} saving={editing.saving} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Section 2: Asset-class rates ──────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Depreciation rates</h2>
        <p className="text-sm text-gray-500 mb-4">
          Edit the annual rate and useful life for each asset class. Rate is stored as a fraction
          and displayed as a percentage. The set of classes is fixed.
        </p>

        {/* Desktop table (md+) */}
        <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                {['Class', 'Name', 'Useful Life', 'Annual Rate', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assetClasses.map(ac => {
                const isEditing = editing?.type === 'assetClass' && editing.code === ac.code

                return (
                  <tr key={ac.code} className="hover:bg-gray-50 transition-colors duration-200">
                    <td className="px-4 py-3 font-mono text-base text-gray-900 whitespace-nowrap">{ac.code}</td>
                    <td className="px-4 py-3 text-base text-gray-900">{ac.name}</td>

                    {isEditing && editing.type === 'assetClass' ? (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={editing.draftLife}
                              onChange={e => setEditing(prev => prev && { ...prev, draftLife: e.target.value })}
                              className={smallInputCls}
                              autoFocus
                            />
                            <span className="text-sm text-gray-500">yrs</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0.01"
                              max="100"
                              step="0.01"
                              value={editing.draftRate}
                              onChange={e => setEditing(prev => prev && { ...prev, draftRate: e.target.value })}
                              className={smallInputCls}
                            />
                            <span className="text-sm text-gray-500">%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            {editing.error && (
                              <p className="text-xs text-red-700">{editing.error}</p>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={saveAssetClass}
                                disabled={editing.saving}
                                className="min-h-[44px] px-4 text-sm font-medium rounded-lg bg-navy-vivid text-white hover:bg-navy-deep focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 disabled:opacity-50 transition-colors duration-200"
                              >
                                {editing.saving ? '…' : 'Save'}
                              </button>
                              <button
                                onClick={cancel}
                                disabled={editing.saving}
                                className="min-h-[44px] px-4 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200 transition-colors duration-200"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-base text-gray-700 whitespace-nowrap tabular-nums">
                          {ac.useful_life_years} yrs
                        </td>
                        <td className="px-4 py-3 text-base text-gray-700 whitespace-nowrap tabular-nums">
                          {(ac.annual_rate * 100).toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => openAssetEdit(ac)}
                            className="min-h-[44px] px-4 text-sm font-medium text-navy-vivid border border-navy-vivid/30 rounded-lg hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
                          >
                            Edit
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below md) */}
        <div className="md:hidden space-y-3">
          {assetClasses.map(ac => {
            const isEditing = editing?.type === 'assetClass' && editing.code === ac.code

            return (
              <div key={ac.code} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-base font-semibold text-gray-900">{ac.code}</span>
                    <p className="text-base text-gray-900 mt-0.5">{ac.name}</p>
                  </div>
                  {!isEditing && (
                    <button
                      onClick={() => openAssetEdit(ac)}
                      className="min-h-[44px] px-4 text-sm font-medium text-navy-vivid border border-navy-vivid/30 rounded-lg hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200 flex-shrink-0"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {isEditing && editing.type === 'assetClass' ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Useful life (years)</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={editing.draftLife}
                        onChange={e => setEditing(prev => prev && { ...prev, draftLife: e.target.value })}
                        className={inputCls}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Annual rate (%)</label>
                      <input
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={editing.draftRate}
                        onChange={e => setEditing(prev => prev && { ...prev, draftRate: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                    {editing.error && (
                      <p className="text-sm text-red-800">{editing.error}</p>
                    )}
                    <SaveCancelRow onSave={saveAssetClass} saving={editing.saving} />
                  </div>
                ) : (
                  <div className="flex gap-6 text-sm text-gray-600">
                    <span>Life: <strong className="text-gray-900 tabular-nums">{ac.useful_life_years} yrs</strong></span>
                    <span>Rate: <strong className="text-gray-900 tabular-nums">{(ac.annual_rate * 100).toFixed(2)}%</strong></span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
