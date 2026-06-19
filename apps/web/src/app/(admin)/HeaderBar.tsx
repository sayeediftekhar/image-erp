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
  email: string
  role: string
}

export default function HeaderBar({ email, role }: Props) {
  const pathname = usePathname()
  const title = PAGE_TITLES[pathname] ?? 'Admin'

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
      <h1 className="text-base font-semibold text-gray-900">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-gray-800 leading-tight">{email}</p>
          <p className="text-xs text-gray-500 leading-tight">{role}</p>
        </div>
        <LogoutButton />
      </div>
    </header>
  )
}
