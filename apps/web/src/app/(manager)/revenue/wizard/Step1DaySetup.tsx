'use client'

import type { EntityCapabilities } from '@/lib/capabilities'
import { CHANNEL, getChannelDescriptors, type Channel } from '@/lib/revenue/channels'

interface Props {
  caps:              EntityCapabilities
  activeChannels:    Set<Channel>
  teamCount:         number
  onToggleChannel:   (token: Channel) => void
  onTeamCountChange: (n: number) => void
}

export default function Step1DaySetup({
  caps,
  activeChannels,
  teamCount,
  onToggleChannel,
  onTeamCountChange,
}: Props) {
  const descriptors = getChannelDescriptors(caps)

  return (
    <div>
      <h2 className="text-gray-900 text-lg font-bold mb-1">Which channels ran today?</h2>
      <p className="text-gray-500 text-sm mb-5 leading-relaxed">
        Select only what happened — the wizard will ask for data on what you include.
      </p>

      <div className="divide-y divide-gray-100">
        {descriptors.map(d => (
          <div key={d.token}>
            <div className="flex items-center justify-between py-3.5">
              <span className="text-base font-medium text-gray-900">{d.label}</span>
              <button
                role="switch"
                aria-checked={activeChannels.has(d.token)}
                aria-label={`Toggle ${d.label}`}
                onClick={() => onToggleChannel(d.token)}
                className={[
                  'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full',
                  'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#13007D]',
                  activeChannels.has(d.token) ? 'bg-[#13007D]' : 'bg-gray-300',
                ].join(' ')}
              >
                <span
                  className={[
                    'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                    activeChannels.has(d.token) ? 'translate-x-6' : 'translate-x-1',
                  ].join(' ')}
                />
              </button>
            </div>

            {/* Team count stepper — shown when Satellite is toggled on */}
            {d.token === CHANNEL.SATELLITE && activeChannels.has(CHANNEL.SATELLITE) && (
              <div className="pb-4 pl-2 flex items-center gap-3">
                <span className="text-sm text-gray-600">Teams today:</span>
                <button
                  onClick={() => onTeamCountChange(Math.max(1, teamCount - 1))}
                  aria-label="Decrease team count"
                  className="w-9 h-9 rounded-lg border border-gray-300 text-gray-700 font-bold text-lg flex items-center justify-center select-none"
                >
                  −
                </button>
                <span className="text-base font-bold w-5 text-center tabular-nums">{teamCount}</span>
                <button
                  onClick={() => onTeamCountChange(Math.min(5, teamCount + 1))}
                  aria-label="Increase team count"
                  className="w-9 h-9 rounded-lg border border-gray-300 text-gray-700 font-bold text-lg flex items-center justify-center select-none"
                >
                  +
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
