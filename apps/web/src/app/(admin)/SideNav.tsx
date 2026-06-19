'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_SECTIONS = [
  {
    label: 'FINANCE',
    items: [
      { label: 'Chart of Accounts', href: '/accounts', built: true  },
      { label: 'Parties',           href: '/parties',  built: true  },
      { label: 'Fixed Assets',      href: '/assets',   built: true  },
    ],
  },
  {
    label: 'ADMINISTRATION',
    items: [
      { label: 'Users',    href: '/users',    built: true  },
      { label: 'Settings', href: '/settings', built: true  },
    ],
  },
]

interface Props {
  onNavigate?: () => void
}

export default function SideNav({ onNavigate }: Props) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-2 py-4 space-y-6 overflow-y-auto" aria-label="Main navigation">
      {NAV_SECTIONS.map(section => (
        <div key={section.label}>
          <p className="px-3 mb-1 text-[10px] font-semibold tracking-widest text-white/50 uppercase select-none">
            {section.label}
          </p>
          <div className="space-y-0.5">
            {section.items.map(item => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')

              if (!item.built) {
                return (
                  <span
                    key={item.href}
                    className="flex items-center min-h-[44px] px-3 rounded-md text-sm font-medium text-white/30 cursor-default select-none"
                  >
                    {item.label}
                  </span>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`flex items-center min-h-[44px] px-3 rounded-md text-sm font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-white/60 ${
                    isActive
                      ? 'bg-navy-vivid text-white'
                      : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
