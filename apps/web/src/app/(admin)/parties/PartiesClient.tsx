'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import PartyModal from './PartyModal'
import { PARTY_KINDS, type Party, type PartyKind, type ControlAccount } from './types'

// ── Badge helpers ─────────────────────────────────────────────────────────────

const KIND_PILL: Record<PartyKind, string> = {
  VENDOR:       'bg-blue-50 text-blue-900',
  DEBTOR:       'bg-green-50 text-green-900',
  INSTRUMENT:   'bg-purple-50 text-purple-900',
  COUNTERPARTY: 'bg-amber-50 text-amber-900',
}

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}>
      {label}
    </span>
  )
}

const statusPill = (active: boolean) =>
  active ? 'bg-green-50 text-green-900' : 'bg-gray-100 text-gray-800'

// ── Modal state ───────────────────────────────────────────────────────────────

type ModalState = null | { mode: 'add' } | { mode: 'edit'; party: Party }

// ── Main component ────────────────────────────────────────────────────────────

export default function PartiesClient({
  initialParties,
  controlAccounts,
}: {
  initialParties:  Party[]
  controlAccounts: ControlAccount[]
}) {
  const [parties,      setParties]      = useState<Party[]>(initialParties)
  const [search,       setSearch]       = useState('')
  const [kindFilter,   setKindFilter]   = useState<PartyKind | ''>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('')
  const [modal,        setModal]        = useState<ModalState>(null)
  const [toggling,     setToggling]     = useState<string | null>(null)

  const refetch = async () => {
    const supabase = createClient()
    const { data } = await supabase.from('parties').select('*').order('name')
    if (data) setParties(data as Party[])
  }

  const handleToggleActive = async (id: string, newActive: boolean) => {
    setToggling(id)
    const supabase = createClient()
    await supabase.from('parties').update({ active: newActive }).eq('id', id)
    await refetch()
    setToggling(null)
  }

  const filtered = parties.filter(p => {
    if (search) {
      const q = search.toLowerCase()
      if (!p.name.toLowerCase().includes(q)) return false
    }
    if (kindFilter   && p.kind !== kindFilter)               return false
    if (statusFilter === 'active'   && !p.active)            return false
    if (statusFilter === 'inactive' &&  p.active)            return false
    return true
  })

  return (
    <>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Search by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full md:w-64 px-4 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200"
        />

        <select
          value={kindFilter}
          onChange={e => setKindFilter(e.target.value as PartyKind | '')}
          className="w-full md:w-auto px-4 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200"
        >
          <option value="">All kinds</option>
          {PARTY_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as '' | 'active' | 'inactive')}
          className="w-full md:w-auto px-4 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200"
        >
          <option value="">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>

        <button
          onClick={() => setModal({ mode: 'add' })}
          className="w-full md:w-auto md:ml-auto min-h-[44px] px-5 py-2.5 bg-navy-vivid text-white text-base font-medium rounded-lg hover:bg-navy-deep focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 transition-all duration-200"
        >
          + Add party
        </button>
      </div>

      {/* ── Desktop table (md+) ─────────────────────────────────────────────── */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                {['Name', 'Kind', 'Control Account', 'Contact', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                    {parties.length === 0
                      ? 'No parties yet — add the first one.'
                      : 'No parties match the current filters.'}
                  </td>
                </tr>
              )}
              {filtered.map(p => (
                <tr
                  key={p.id}
                  className={`hover:bg-gray-50 transition-colors duration-200 ${!p.active ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3 text-base text-gray-900 max-w-[200px] truncate font-medium" title={p.name}>
                    {p.name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Pill label={p.kind} className={KIND_PILL[p.kind]} />
                  </td>
                  <td className="px-4 py-3 font-mono text-base text-gray-700 whitespace-nowrap">
                    {p.control_account ?? <span className="text-gray-300 font-sans">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-[180px] truncate" title={p.contact ?? ''}>
                    {p.contact ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Pill label={p.active ? 'Active' : 'Inactive'} className={statusPill(p.active)} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModal({ mode: 'edit', party: p })}
                        className="min-h-[44px] px-3 flex items-center text-sm font-medium text-navy-vivid rounded-md hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleActive(p.id, !p.active)}
                        disabled={toggling === p.id}
                        className="min-h-[44px] px-3 flex items-center text-sm font-medium text-gray-600 rounded-md hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-40 transition-colors duration-200 whitespace-nowrap"
                      >
                        {toggling === p.id ? '…' : p.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
          {filtered.length === parties.length
            ? `${parties.length} ${parties.length === 1 ? 'party' : 'parties'}`
            : `${filtered.length} of ${parties.length} parties`}
        </div>
      </div>

      {/* ── Mobile cards (below md) ──────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-10">
            {parties.length === 0
              ? 'No parties yet — add the first one.'
              : 'No parties match the current filters.'}
          </p>
        )}
        {filtered.map(p => (
          <div
            key={p.id}
            className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3 ${!p.active ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-base font-semibold text-gray-900 leading-snug">{p.name}</p>
              <Pill label={p.active ? 'Active' : 'Inactive'} className={statusPill(p.active)} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Pill label={p.kind} className={KIND_PILL[p.kind]} />
              {p.control_account && (
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-gray-50 text-gray-800 whitespace-nowrap">
                  {p.control_account}
                </span>
              )}
            </div>

            {p.contact && (
              <p className="text-sm text-gray-500 truncate">{p.contact}</p>
            )}

            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => setModal({ mode: 'edit', party: p })}
                className="flex-1 min-h-[44px] text-sm font-medium text-navy-vivid border border-navy-vivid/30 rounded-lg hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
              >
                Edit
              </button>
              <button
                onClick={() => handleToggleActive(p.id, !p.active)}
                disabled={toggling === p.id}
                className="flex-1 min-h-[44px] text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-40 transition-colors duration-200"
              >
                {toggling === p.id ? '…' : p.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        ))}

        {filtered.length > 0 && (
          <p className="text-center text-xs text-gray-400 pt-1 pb-2">
            {filtered.length === parties.length
              ? `${parties.length} ${parties.length === 1 ? 'party' : 'parties'}`
              : `${filtered.length} of ${parties.length} parties`}
          </p>
        )}
      </div>

      {/* ── Modal ───────────────────────────────────────────────────────────── */}
      {modal && (
        <PartyModal
          party={modal.mode === 'edit' ? modal.party : null}
          controlAccounts={controlAccounts}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null)
            await refetch()
          }}
        />
      )}
    </>
  )
}
