'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getDhakaToday } from '@/lib/revenue/classify'

interface Props {
  from: string
  to: string
}

export default function PeriodSelector({ from, to }: Props) {
  const router = useRouter()
  const [localFrom, setLocalFrom] = useState(from)
  const [localTo, setLocalTo]     = useState(to)

  function navigate(newFrom: string, newTo: string) {
    if (!newFrom || !newTo || newFrom > newTo) return
    router.replace(`/expenses?from=${newFrom}&to=${newTo}`)
  }

  function resetToThisMonth() {
    const today = getDhakaToday()
    const [y, m] = today.split('-').map(Number)
    const mm = String(m).padStart(2, '0')
    const lastDay = new Date(y, m, 0).getDate()
    const f = `${y}-${mm}-01`
    const t = `${y}-${mm}-${String(lastDay).padStart(2, '0')}`
    setLocalFrom(f)
    setLocalTo(t)
    router.replace(`/expenses?from=${f}&to=${t}`)
  }

  return (
    <div className="px-4 py-3 flex items-center gap-2">
      <input
        type="date"
        value={localFrom}
        max={localTo}
        onChange={(e) => {
          const val = e.target.value
          setLocalFrom(val)
          navigate(val, localTo)
        }}
        className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        aria-label="Period start date"
      />
      <span className="text-gray-400 text-xs shrink-0">to</span>
      <input
        type="date"
        value={localTo}
        min={localFrom}
        onChange={(e) => {
          const val = e.target.value
          setLocalTo(val)
          navigate(localFrom, val)
        }}
        className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        aria-label="Period end date"
      />
      <button
        onClick={resetToThisMonth}
        className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
      >
        This month
      </button>
    </div>
  )
}
