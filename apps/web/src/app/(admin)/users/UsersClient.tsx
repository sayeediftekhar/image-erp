'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import UserModal from './UserModal'
import { APP_ROLES, type AppUser, type AppRole, type EntityOption } from './types'

// ── Badge helpers ─────────────────────────────────────────────────────────────

const ROLE_PILL: Record<AppRole, string> = {
  ADMIN:      'bg-red-50 text-red-900',
  HQ_FINANCE: 'bg-purple-50 text-purple-900',
  ENTRY:      'bg-blue-50 text-blue-900',
  READ_ONLY:  'bg-gray-100 text-gray-800',
}

const ROLE_LABEL: Record<AppRole, string> = {
  ADMIN:      'Admin',
  HQ_FINANCE: 'HQ Finance',
  ENTRY:      'Entry',
  READ_ONLY:  'Read-only',
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

type ModalState = null | { mode: 'add' } | { mode: 'edit'; appUser: AppUser }

// ── Main component ────────────────────────────────────────────────────────────

export default function UsersClient({
  initialUsers,
  entities,
  currentUserId,
}: {
  initialUsers:  AppUser[]
  entities:      EntityOption[]
  currentUserId: string
}) {
  const [users,        setUsers]        = useState<AppUser[]>(initialUsers)
  const [search,       setSearch]       = useState('')
  const [roleFilter,   setRoleFilter]   = useState<AppRole | ''>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('')
  const [modal,        setModal]        = useState<ModalState>(null)
  const [toggling,     setToggling]     = useState<string | null>(null)
  const [selfError,    setSelfError]    = useState<string | null>(null)

  const entityMap = new Map(entities.map(e => [e.id, e]))

  const refetch = async () => {
    const supabase = createClient()
    const { data } = await supabase.from('app_users').select('*').order('full_name')
    if (data) setUsers(data as AppUser[])
  }

  const handleToggleActive = async (id: string, newActive: boolean) => {
    setSelfError(null)
    if (id === currentUserId && !newActive) {
      setSelfError('You cannot deactivate your own account.')
      return
    }
    setToggling(id)
    const supabase = createClient()
    await supabase.from('app_users').update({ active: newActive }).eq('id', id)
    await refetch()
    setToggling(null)
  }

  const filtered = users.filter(u => {
    if (search && !(u.full_name ?? '').toLowerCase().includes(search.toLowerCase())) return false
    if (roleFilter   && u.role !== roleFilter)               return false
    if (statusFilter === 'active'   && !u.active)            return false
    if (statusFilter === 'inactive' &&  u.active)            return false
    return true
  })

  const entityLabel = (u: AppUser) => {
    if (!u.entity_id) return <span className="text-gray-400">— all entities</span>
    const e = entityMap.get(u.entity_id)
    return e ? `${e.code} — ${e.name}` : u.entity_id.slice(0, 8)
  }

  const selectCls = 'w-full md:w-auto px-4 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200'

  return (
    <>
      {/* ── Self-error banner ────────────────────────────────────────────────── */}
      {selfError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 flex items-center justify-between">
          <span>{selfError}</span>
          <button
            onClick={() => setSelfError(null)}
            className="ml-4 text-red-400 hover:text-red-700 font-bold leading-none"
          >
            ×
          </button>
        </div>
      )}

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
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as AppRole | '')}
          className={selectCls}
        >
          <option value="">All roles</option>
          {APP_ROLES.map(r => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as '' | 'active' | 'inactive')}
          className={selectCls}
        >
          <option value="">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>

        <button
          onClick={() => setModal({ mode: 'add' })}
          className="w-full md:w-auto md:ml-auto min-h-[44px] px-5 py-2.5 bg-navy-vivid text-white text-base font-medium rounded-lg hover:bg-navy-deep focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 transition-all duration-200"
        >
          + Add user
        </button>
      </div>

      {/* ── Desktop table (md+) ─────────────────────────────────────────────── */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                {['Full name', 'Role', 'Entity', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                    {users.length === 0
                      ? 'No users yet.'
                      : 'No users match the current filters.'}
                  </td>
                </tr>
              )}
              {filtered.map(u => {
                const isSelf = u.id === currentUserId
                return (
                  <tr
                    key={u.id}
                    className={`hover:bg-gray-50 transition-colors duration-200 ${!u.active ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3 text-base font-medium text-gray-900 max-w-[200px] truncate" title={u.full_name ?? ''}>
                      {u.full_name ?? <span className="text-gray-400 font-normal">—</span>}
                      {isSelf && (
                        <span className="ml-2 text-xs text-gray-400 font-normal">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Pill label={ROLE_LABEL[u.role]} className={ROLE_PILL[u.role]} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {entityLabel(u)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Pill label={u.active ? 'Active' : 'Inactive'} className={statusPill(u.active)} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setModal({ mode: 'edit', appUser: u })}
                          className="min-h-[44px] px-3 flex items-center text-sm font-medium text-navy-vivid rounded-md hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleActive(u.id, !u.active)}
                          disabled={toggling === u.id || isSelf}
                          title={isSelf ? 'You cannot deactivate your own account' : undefined}
                          className="min-h-[44px] px-3 flex items-center text-sm font-medium text-gray-600 rounded-md hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap"
                        >
                          {toggling === u.id ? '…' : u.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
          {filtered.length === users.length
            ? `${users.length} ${users.length === 1 ? 'user' : 'users'}`
            : `${filtered.length} of ${users.length} users`}
        </div>
      </div>

      {/* ── Mobile cards (below md) ──────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-10">
            {users.length === 0
              ? 'No users yet.'
              : 'No users match the current filters.'}
          </p>
        )}
        {filtered.map(u => {
          const isSelf = u.id === currentUserId
          return (
            <div
              key={u.id}
              className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3 ${!u.active ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-gray-900 leading-snug">
                    {u.full_name ?? <span className="text-gray-400 font-normal">—</span>}
                    {isSelf && (
                      <span className="ml-2 text-xs text-gray-400 font-normal">(you)</span>
                    )}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">{entityLabel(u)}</p>
                </div>
                <Pill label={u.active ? 'Active' : 'Inactive'} className={statusPill(u.active)} />
              </div>

              <div>
                <Pill label={ROLE_LABEL[u.role]} className={ROLE_PILL[u.role]} />
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => setModal({ mode: 'edit', appUser: u })}
                  className="flex-1 min-h-[44px] text-sm font-medium text-navy-vivid border border-navy-vivid/30 rounded-lg hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleToggleActive(u.id, !u.active)}
                  disabled={toggling === u.id || isSelf}
                  title={isSelf ? 'You cannot deactivate your own account' : undefined}
                  className="flex-1 min-h-[44px] text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200"
                >
                  {toggling === u.id ? '…' : u.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          )
        })}

        {filtered.length > 0 && (
          <p className="text-center text-xs text-gray-400 pt-1 pb-2">
            {filtered.length === users.length
              ? `${users.length} ${users.length === 1 ? 'user' : 'users'}`
              : `${filtered.length} of ${users.length} users`}
          </p>
        )}
      </div>

      {/* ── Modal ───────────────────────────────────────────────────────────── */}
      {modal && (
        <UserModal
          appUser={modal.mode === 'edit' ? modal.appUser : null}
          entities={entities}
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
