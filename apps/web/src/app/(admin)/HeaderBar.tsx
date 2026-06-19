'use client'

import { usePathname } from 'next/navigation'
import LogoutButton from './LogoutButton'

const PAGE_TITLES: Record<string, string> = {
  '/accounts': 'Chart of Accounts',
  '/parties':  'Parties',
  '/settings': 'Settings',
  '/assets':   'Fixed Assets',
  '/users':    'Users',
}

interface Props {
  email:      string
  role:       string
  onMenuOpen: () => void
}

export default function HeaderBar({ email, role, onMenuOpen }: Props) {
  const pathname = usePathname()
  const title = PAGE_TITLES[pathname] ?? 'Admin'

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuOpen}
          aria-label="Open navigation"
          className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center -ml-1 rounded-md text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-navy-vivid/50 transition-colors duration-200"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <rect y="3"  width="20" height="2" rx="1"/>
            <rect y="9"  width="20" height="2" rx="1"/>
            <rect y="15" width="20" height="2" rx="1"/>
          </svg>
        </button>
        <h1 className="text-base font-semibold text-gray-900">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-gray-800 leading-tight truncate max-w-[160px] md:max-w-none">
            {email}
          </p>
          <p className="text-xs text-gray-500 leading-tight">{role}</p>
        </div>
        <LogoutButton />
      </div>
    </header>
  )
}
