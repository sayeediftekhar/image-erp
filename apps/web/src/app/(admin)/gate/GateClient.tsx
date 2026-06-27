'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EntityRow, OverrideRow } from './types'

interface Props {
  entities:  EntityRow[]
  overrides: OverrideRow[]
}

export default function GateClient({ entities, overrides }: Props) {
  const router = useRouter()

  // ── Go-live month editing ──────────────────────────────────────────────────
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [goLiveErr,    setGoLiveErr]    = useState<string | null>(null)
  const [goLiveSaving, setGoLiveSaving] = useState(false)

  const startEditGoLive = (entity: EntityRow) => {
    setEditingId(entity.id)
    setEditingValue(entity.go_live_month ?? '')
    setGoLiveErr(null)
  }

  const cancelEditGoLive = () => {
    setEditingId(null)
    setGoLiveErr(null)
  }

  const saveGoLive = async (entityId: string) => {
    const val = editingValue.trim()
    if (val !== '' && !/^\d{4}-\d{2}$/.test(val)) {
      setGoLiveErr('Must be YYYY-MM or blank to clear')
      return
    }
    setGoLiveSaving(true)
    setGoLiveErr(null)
    try {
      const res = await fetch('/api/admin/gate/go-live', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId, goLiveMonth: val === '' ? null : val }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setGoLiveErr((body as { error?: string }).error ?? `Error ${res.status}`)
      } else {
        setEditingId(null)
        router.refresh()
      }
    } catch {
      setGoLiveErr('Network error — try again')
    } finally {
      setGoLiveSaving(false)
    }
  }

  // ── Grant override ─────────────────────────────────────────────────────────
  const [grantEntityId,   setGrantEntityId]   = useState('')
  const [grantMonth,      setGrantMonth]       = useState('')
  const [grantNote,       setGrantNote]        = useState('')
  const [grantErr,        setGrantErr]         = useState<string | null>(null)
  const [grantSaving,     setGrantSaving]      = useState(false)

  const handleGrant = async () => {
    if (!grantEntityId) { setGrantErr('Select an entity'); return }
    if (!/^\d{4}-\d{2}$/.test(grantMonth)) { setGrantErr('Month must be YYYY-MM'); return }
    setGrantSaving(true)
    setGrantErr(null)
    try {
      const res = await fetch('/api/admin/gate/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: grantEntityId, gatedMonth: grantMonth, note: grantNote || null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setGrantErr((body as { error?: string }).error ?? `Error ${res.status}`)
      } else {
        setGrantEntityId('')
        setGrantMonth('')
        setGrantNote('')
        router.refresh()
      }
    } catch {
      setGrantErr('Network error — try again')
    } finally {
      setGrantSaving(false)
    }
  }

  // ── Revoke override ────────────────────────────────────────────────────────
  const [revokeErr, setRevokeErr] = useState<string | null>(null)

  const handleRevoke = async (entityId: string, gatedMonth: string) => {
    if (!confirm(`Revoke override for ${gatedMonth}? The manager will be re-blocked if the prior month is still incomplete.`)) return
    setRevokeErr(null)
    try {
      const res = await fetch('/api/admin/gate/override', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId, gatedMonth }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setRevokeErr((body as { error?: string }).error ?? `Error ${res.status}`)
      } else {
        router.refresh()
      }
    } catch {
      setRevokeErr('Network error — try again')
    }
  }

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto space-y-10">
      <h1 className="text-2xl font-bold text-gray-900">Gate Control</h1>

      {/* ── Section 1: Go-live months ─────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Entity Go-Live Months</h2>
        <p className="text-sm text-gray-500 mb-4">
          The first gated month per entity. Blank = gate dormant (never enforced).
          Set this once at go-live — managers of months before this are never gated.
        </p>
        {goLiveErr && (
          <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            {goLiveErr}
          </div>
        )}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Entity</th>
                <th className="text-left px-4 py-3">Go-Live Month</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entities.map(e => (
                <tr key={e.id} className="bg-white hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <span className="text-xs text-gray-400 mr-1">{e.code}</span>{e.name}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === e.id ? (
                      <input
                        type="text"
                        value={editingValue}
                        onChange={ev => setEditingValue(ev.target.value)}
                        placeholder="YYYY-MM or blank"
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-32"
                        autoFocus
                      />
                    ) : (
                      <span className={e.go_live_month ? 'text-gray-900 font-mono' : 'text-gray-400'}>
                        {e.go_live_month ?? '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === e.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => saveGoLive(e.id)}
                          disabled={goLiveSaving}
                          className="text-xs font-semibold text-white bg-indigo-900 px-3 py-1.5 rounded-md disabled:opacity-50"
                        >
                          {goLiveSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEditGoLive}
                          className="text-xs text-gray-500 px-2 py-1.5"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditGoLive(e)}
                        className="text-xs text-indigo-800 font-medium hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Section 2: Active overrides ───────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Active Overrides</h2>
        <p className="text-sm text-gray-500 mb-4">
          An override lets a manager enter a gated month despite the prior month being incomplete.
          Revoking it re-blocks the manager if the prior month is still incomplete.
        </p>

        {revokeErr && (
          <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            {revokeErr}
          </div>
        )}

        {/* Grant form */}
        <div className="mb-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Grant new override</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Entity</label>
              <select
                value={grantEntityId}
                onChange={e => setGrantEntityId(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="">— select —</option>
                {entities.map(e => (
                  <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Month (YYYY-MM)</label>
              <input
                type="text"
                value={grantMonth}
                onChange={e => setGrantMonth(e.target.value)}
                placeholder="2026-07"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-28"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-gray-500 mb-0.5">Note (optional)</label>
              <input
                type="text"
                value={grantNote}
                onChange={e => setGrantNote(e.target.value)}
                placeholder="Reason…"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full"
              />
            </div>
            <button
              onClick={handleGrant}
              disabled={grantSaving}
              className="text-sm font-semibold text-white bg-indigo-900 min-h-[36px] px-4 rounded-lg disabled:opacity-50"
            >
              {grantSaving ? 'Saving…' : 'Grant'}
            </button>
          </div>
          {grantErr && <p className="text-xs text-red-600">{grantErr}</p>}
        </div>

        {/* Override table */}
        {overrides.length === 0 ? (
          <p className="text-sm text-gray-400">No active overrides.</p>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Entity</th>
                  <th className="text-left px-4 py-3">Month</th>
                  <th className="text-left px-4 py-3">Granted</th>
                  <th className="text-left px-4 py-3">Note</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {overrides.map(ov => (
                  <tr key={ov.id} className="bg-white hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{ov.entity_name}</td>
                    <td className="px-4 py-3 font-mono text-gray-700">{ov.gated_month}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(ov.granted_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{ov.note ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRevoke(ov.entity_id, ov.gated_month)}
                        className="text-xs text-red-600 font-medium hover:underline"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
