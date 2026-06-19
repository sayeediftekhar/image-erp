'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import AccountModal from './AccountModal'
import { ACCOUNT_TYPES, type Account, type AccountType } from './types'

// ── Badge helpers ─────────────────────────────────────────────────────────────

const TYPE_PILL: Record<AccountType, string> = {
  ASSET:     'bg-blue-50 text-blue-900',
  LIABILITY: 'bg-orange-50 text-orange-900',
  FUND:      'bg-purple-50 text-purple-900',
  INCOME:    'bg-green-50 text-green-900',
  EXPENSE:   'bg-red-50 text-red-900',
}

const NB_PILL: Record<string, string> = {
  DEBIT:  'bg-sky-50 text-sky-900',
  CREDIT: 'bg-amber-50 text-amber-900',
}

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}>
      {label}
    </span>
  )
}

// ── Modal state type ──────────────────────────────────────────────────────────

type ModalState = null | { mode: 'add' } | { mode: 'edit'; account: Account }

// ── Main component ────────────────────────────────────────────────────────────

export default function AccountsClient({
  initialAccounts,
}: {
  initialAccounts: Account[]
}) {
  const [accounts,     setAccounts]     = useState<Account[]>(initialAccounts)
  const [search,       setSearch]       = useState('')
  const [typeFilter,   setTypeFilter]   = useState<AccountType | ''>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('')
  const [modal,        setModal]        = useState<ModalState>(null)
  const [toggling,     setToggling]     = useState<string | null>(null)

  // Refetch the full list after any mutation — keeps the table in sync with DB
  const refetch = async () => {
    const supabase = createClient()
    const { data } = await supabase.from('accounts').select('*').order('code')
    if (data) setAccounts(data as Account[])
  }

  // Deactivate / Reactivate — never hard-delete (Blueprint §8)
  const handleToggleActive = async (code: string, newActive: boolean) => {
    setToggling(code)
    const supabase = createClient()
    await supabase.from('accounts').update({ active: newActive }).eq('code', code)
    await refetch()
    setToggling(null)
  }

  // Client-side search + filter (≈59 rows — no pagination needed)
  const filtered = accounts.filter(a => {
    if (search) {
      const q = search.toLowerCase()
      if (!a.code.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) return false
    }
    if (typeFilter   && a.type !== typeFilter)                  return false
    if (statusFilter === 'active'   && !a.active)               return false
    if (statusFilter === 'inactive' &&  a.active)               return false
    return true
  })

  return (
    <>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Search code or name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200 w-64"
        />

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as AccountType | '')}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200"
        >
          <option value="">All types</option>
          {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as '' | 'active' | 'inactive')}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200"
        >
          <option value="">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>

        <button
          onClick={() => setModal({ mode: 'add' })}
          className="ml-auto min-h-[44px] px-5 py-2.5 bg-navy-vivid text-white text-base font-medium rounded-lg hover:bg-navy-deep focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 transition-all duration-200"
        >
          + Add account
        </button>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                {['Code', 'Name', 'Type', 'Bal', 'Fund', 'Ctrl', 'Appr', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">
                    No accounts match the current filters.
                  </td>
                </tr>
              )}
              {filtered.map(a => (
                <tr
                  key={a.code}
                  className={`hover:bg-gray-50 transition-colors duration-200 ${!a.active ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3 font-mono text-base text-gray-900 whitespace-nowrap">{a.code}</td>
                  <td className="px-4 py-3 text-base text-gray-900 max-w-[220px] truncate" title={a.name}>{a.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Pill label={a.type} className={TYPE_PILL[a.type]} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Pill label={a.normal_balance} className={NB_PILL[a.normal_balance]} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                    {a.fund ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600 text-sm">
                    {a.is_control ? '✓' : <span className="text-gray-300">–</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600 text-sm">
                    {a.requires_approval ? '✓' : <span className="text-gray-300">–</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Pill
                      label={a.active ? 'Active' : 'Inactive'}
                      className={a.active ? 'bg-green-50 text-green-900' : 'bg-gray-100 text-gray-800'}
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModal({ mode: 'edit', account: a })}
                        className="min-h-[44px] px-3 flex items-center text-sm font-medium text-navy-vivid rounded-md hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleActive(a.code, !a.active)}
                        disabled={toggling === a.code}
                        className="min-h-[44px] px-3 flex items-center text-sm font-medium text-gray-600 rounded-md hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-40 transition-colors duration-200 whitespace-nowrap"
                      >
                        {toggling === a.code
                          ? '…'
                          : a.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Row count footer */}
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
          {filtered.length === accounts.length
            ? `${accounts.length} accounts`
            : `${filtered.length} of ${accounts.length} accounts`}
        </div>
      </div>

      {/* ── Modal ───────────────────────────────────────────────────────────── */}
      {modal && (
        <AccountModal
          account={modal.mode === 'edit' ? modal.account : null}
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
