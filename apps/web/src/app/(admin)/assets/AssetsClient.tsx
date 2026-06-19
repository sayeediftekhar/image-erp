'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import AssetModal from './AssetModal'
import type { FixedAsset, Entity, AssetClassOption } from './types'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtBDT(amount: number): string {
  return 'Tk ' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

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

type ModalState = null | { mode: 'add' } | { mode: 'edit'; asset: FixedAsset }

// ── Main component ────────────────────────────────────────────────────────────

export default function AssetsClient({
  initialAssets,
  entities,
  assetClasses,
  capitalisationThreshold,
}: {
  initialAssets:            FixedAsset[]
  entities:                 Entity[]
  assetClasses:             AssetClassOption[]
  capitalisationThreshold:  number | null
}) {
  const [assets,        setAssets]        = useState<FixedAsset[]>(initialAssets)
  const [search,        setSearch]        = useState('')
  const [entityFilter,  setEntityFilter]  = useState('')
  const [classFilter,   setClassFilter]   = useState('')
  const [statusFilter,  setStatusFilter]  = useState<'' | 'active' | 'inactive'>('')
  const [modal,         setModal]         = useState<ModalState>(null)
  const [toggling,      setToggling]      = useState<string | null>(null)

  const entityMap = new Map(entities.map(e => [e.id, e]))

  const refetch = async () => {
    const supabase = createClient()
    const { data } = await supabase.from('fixed_assets').select('*').order('name')
    if (data) setAssets(data as FixedAsset[])
  }

  const handleToggleActive = async (id: string, newActive: boolean) => {
    setToggling(id)
    const supabase = createClient()
    await supabase.from('fixed_assets').update({ active: newActive }).eq('id', id)
    await refetch()
    setToggling(null)
  }

  const filtered = assets.filter(a => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
    if (entityFilter  && a.entity_id    !== entityFilter)  return false
    if (classFilter   && a.asset_class  !== classFilter)   return false
    if (statusFilter  === 'active'   && !a.active)         return false
    if (statusFilter  === 'inactive' &&  a.active)         return false
    return true
  })

  const selectCls = 'w-full md:w-auto px-4 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200'

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

        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className={selectCls}>
          <option value="">All entities</option>
          {entities.map(e => (
            <option key={e.id} value={e.id}>{e.code} — {e.name}</option>
          ))}
        </select>

        <select value={classFilter} onChange={e => setClassFilter(e.target.value)} className={selectCls}>
          <option value="">All classes</option>
          {assetClasses.map(ac => (
            <option key={ac.code} value={ac.code}>{ac.code} — {ac.name}</option>
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
          + Add asset
        </button>
      </div>

      {/* ── Desktop table (md+) ─────────────────────────────────────────────── */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                {['Name', 'Entity', 'Class', 'Date', 'Cost', 'Accum. Depr.', 'WDV', 'Status', 'Actions'].map(h => (
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
                    {assets.length === 0
                      ? 'No assets yet — add the first one.'
                      : 'No assets match the current filters.'}
                  </td>
                </tr>
              )}
              {filtered.map(a => {
                const entity = entityMap.get(a.entity_id)
                const wdv    = a.cost - a.accumulated_depreciation
                return (
                  <tr
                    key={a.id}
                    className={`hover:bg-gray-50 transition-colors duration-200 ${!a.active ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3 text-base text-gray-900 max-w-[180px] truncate font-medium" title={a.name}>
                      {a.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-700 whitespace-nowrap">
                      {entity?.code ?? a.entity_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {a.asset_class}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {fmtDate(a.purchase_date)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-900 whitespace-nowrap">
                      {fmtBDT(a.cost)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-500 whitespace-nowrap">
                      {fmtBDT(a.accumulated_depreciation)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-900 whitespace-nowrap">
                      {fmtBDT(wdv)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Pill label={a.active ? 'Active' : 'Inactive'} className={statusPill(a.active)} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setModal({ mode: 'edit', asset: a })}
                          className="min-h-[44px] px-3 flex items-center text-sm font-medium text-navy-vivid rounded-md hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleActive(a.id, !a.active)}
                          disabled={toggling === a.id}
                          className="min-h-[44px] px-3 flex items-center text-sm font-medium text-gray-600 rounded-md hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-40 transition-colors duration-200 whitespace-nowrap"
                        >
                          {toggling === a.id ? '…' : a.active ? 'Deactivate' : 'Reactivate'}
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
          {filtered.length === assets.length
            ? `${assets.length} ${assets.length === 1 ? 'asset' : 'assets'}`
            : `${filtered.length} of ${assets.length} assets`}
        </div>
      </div>

      {/* ── Mobile cards (below md) ──────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-10">
            {assets.length === 0
              ? 'No assets yet — add the first one.'
              : 'No assets match the current filters.'}
          </p>
        )}
        {filtered.map(a => {
          const entity = entityMap.get(a.entity_id)
          const wdv    = a.cost - a.accumulated_depreciation
          return (
            <div
              key={a.id}
              className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3 ${!a.active ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-base font-semibold text-gray-900 leading-snug">{a.name}</p>
                <Pill label={a.active ? 'Active' : 'Inactive'} className={statusPill(a.active)} />
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                {entity && <span className="font-mono font-medium">{entity.code}</span>}
                <span>{a.asset_class}</span>
                <span>{fmtDate(a.purchase_date)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Cost</p>
                  <p className="font-mono text-gray-900">{fmtBDT(a.cost)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">WDV</p>
                  <p className="font-mono text-gray-900">{fmtBDT(wdv)}</p>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => setModal({ mode: 'edit', asset: a })}
                  className="flex-1 min-h-[44px] text-sm font-medium text-navy-vivid border border-navy-vivid/30 rounded-lg hover:bg-navy-vivid/10 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleToggleActive(a.id, !a.active)}
                  disabled={toggling === a.id}
                  className="flex-1 min-h-[44px] text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-40 transition-colors duration-200"
                >
                  {toggling === a.id ? '…' : a.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          )
        })}

        {filtered.length > 0 && (
          <p className="text-center text-xs text-gray-400 pt-1 pb-2">
            {filtered.length === assets.length
              ? `${assets.length} ${assets.length === 1 ? 'asset' : 'assets'}`
              : `${filtered.length} of ${assets.length} assets`}
          </p>
        )}
      </div>

      {/* ── Modal ───────────────────────────────────────────────────────────── */}
      {modal && (
        <AssetModal
          asset={modal.mode === 'edit' ? modal.asset : null}
          entities={entities}
          assetClasses={assetClasses}
          capitalisationThreshold={capitalisationThreshold}
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
