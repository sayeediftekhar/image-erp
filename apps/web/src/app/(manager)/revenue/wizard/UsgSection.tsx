'use client'

import type { UsgEntry } from '@/lib/revenue/draft-merge'

const USG_LABELS: Record<UsgEntry['type'], string> = {
  PP:      'PP',
  LOWER:   'Lower abdomen',
  WHOLE:   'Whole abdomen',
  ANOMALY: 'Anomaly scan',
}
const ALL_TYPES: UsgEntry['type'][] = ['PP', 'LOWER', 'WHOLE', 'ANOMALY']

interface Props {
  value:    UsgEntry[]
  onChange: (entries: UsgEntry[]) => void
}

export default function UsgSection({ value, onChange }: Props) {
  const typesInList = new Set(value.map(e => e.type))
  const addableTypes = ALL_TYPES.filter(t => !typesInList.has(t))

  function updateEntry(index: number, field: 'count' | 'revenue', raw: string) {
    const next = [...value]
    const parsed = field === 'count'
      ? parseInt(raw || '0', 10)
      : parseFloat(raw || '0')
    next[index] = { ...next[index], [field]: isNaN(parsed) || parsed < 0 ? 0 : parsed }
    onChange(next)
  }

  function addType(type: UsgEntry['type']) {
    onChange([...value, { type, count: 0, revenue: 0 }])
  }

  function removeEntry(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        USG <span className="text-gray-400 font-normal normal-case">(→ 4050 PI-USG)</span>
      </p>

      {value.map((entry, i) => (
        <div key={entry.type} className="flex items-center gap-2">
          <span className="text-sm text-gray-700 w-28 shrink-0">{USG_LABELS[entry.type]}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={entry.count || ''}
            onChange={e => updateEntry(i, 'count', e.target.value)}
            placeholder="0"
            aria-label={`${USG_LABELS[entry.type]} count`}
            className="w-16 min-h-[44px] rounded-lg border border-gray-300 px-2 text-sm text-center"
          />
          <span className="text-gray-400 text-sm shrink-0">Tk</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={entry.revenue || ''}
            onChange={e => updateEntry(i, 'revenue', e.target.value)}
            placeholder="0"
            aria-label={`${USG_LABELS[entry.type]} revenue`}
            className="flex-1 min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
          />
          <button
            type="button"
            onClick={() => removeEntry(i)}
            aria-label={`Remove ${USG_LABELS[entry.type]}`}
            className="w-9 h-9 shrink-0 flex items-center justify-center text-gray-400 hover:text-red-500 text-xl leading-none"
          >
            ×
          </button>
        </div>
      ))}

      {addableTypes.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {addableTypes.map(type => (
            <button
              key={type}
              type="button"
              onClick={() => addType(type)}
              className="text-xs font-medium border rounded-full px-3 min-h-[36px]"
              style={{ color: '#13007D', borderColor: 'rgba(19,0,125,0.3)' }}
            >
              + {USG_LABELS[type]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
