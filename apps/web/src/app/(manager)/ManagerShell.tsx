'use client'

import { useState, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getEntityCapabilities, hasDeliveries } from '@/lib/capabilities'

// ── Icons (inline SVGs — no extra dependency) ─────────────────────────────────

function IconHome()      { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> }
function IconRevenue()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> }
function IconExpenses()  { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> }
function IconDelivery()  { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> }
function IconMore()      { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg> }
function IconReports()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> }
function IconBankRec()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> }
function IconSignOut()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> }

// ── Nav config ────────────────────────────────────────────────────────────────

interface NavItem {
  href:    string
  label:   string
  icon:    React.ReactNode
  built:   boolean
  phase?:  string   // e.g. "Phase 2" for stubs
}

function buildNavItems(entityCode: string): { doing: NavItem[]; viewing: NavItem[] } {
  const caps = getEntityCapabilities(entityCode)
  const showDeliveries = hasDeliveries(caps)

  const doing: NavItem[] = [
    { href: '/dashboard', label: 'Home',      icon: <IconHome />,      built: true  },
    { href: '/revenue',   label: 'Revenue',   icon: <IconRevenue />,   built: true  },
    { href: '/expenses',  label: 'Expenses',  icon: <IconExpenses />,  built: false, phase: 'Phase 2' },
    ...(showDeliveries
      ? [{ href: '/deliveries', label: 'Deliveries', icon: <IconDelivery />, built: true }]
      : []),
  ]
  const viewing: NavItem[] = [
    { href: '/reports',  label: 'Reports',          icon: <IconReports />,  built: false, phase: 'Phase 4' },
    { href: '/bank-rec', label: 'Bank Reconciliation', icon: <IconBankRec />, built: false, phase: 'Phase 5' },
  ]
  return { doing, viewing }
}

// ── SignOut ───────────────────────────────────────────────────────────────────

function SignOutButton({ className }: { className?: string }) {
  const router = useRouter()
  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
  return (
    <button
      onClick={handleSignOut}
      className={className}
    >
      <IconSignOut />
      <span>Sign out</span>
    </button>
  )
}

// ── Logo ─────────────────────────────────────────────────────────────────────

function ShellLogo() {
  const [err, setErr] = useState(false)
  return (
    <div className="rounded-full bg-white p-1.5 w-10 h-10 flex-shrink-0 flex items-center justify-center overflow-hidden">
      {err ? (
        <span className="text-navy-vivid font-bold text-sm select-none">IE</span>
      ) : (
        <Image src="/image-logo.png" alt="IMAGE" width={28} height={28} className="object-contain" onError={() => setErr(true)} priority />
      )}
    </div>
  )
}

// ── Desktop Sidebar ───────────────────────────────────────────────────────────

function Sidebar({
  doing, viewing, userName, entityName, onNavigate,
}: {
  doing: NavItem[]; viewing: NavItem[]
  userName: string; entityName: string
  onNavigate?: () => void
}) {
  const pathname = usePathname()

  const linkClass = (href: string, built: boolean) => {
    if (!built) return 'flex items-center gap-2.5 min-h-[44px] px-3 rounded-md text-sm font-medium text-white/30 cursor-default select-none'
    const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/')) || (href === '/dashboard' && pathname === '/dashboard')
    return `flex items-center gap-2.5 min-h-[44px] px-3 rounded-md text-sm font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-white/60 ${
      active ? 'bg-navy-vivid text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'
    }`
  }

  const renderItem = (item: NavItem) => (
    <div key={item.href}>
      {item.built ? (
        <Link href={item.href} onClick={onNavigate} className={linkClass(item.href, true)}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ) : (
        <span className={linkClass(item.href, false)}>
          {item.icon}
          <span>{item.label}</span>
          {item.phase && <span className="ml-auto text-[10px] text-white/20">{item.phase}</span>}
        </span>
      )}
    </div>
  )

  return (
    <aside className="hidden md:flex flex-col w-56 flex-shrink-0 bg-navy-deep">
      {/* Logo + wordmark */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
        <ShellLogo />
        <div className="min-w-0">
          <p className="text-white font-bold text-sm leading-tight">IMAGE</p>
          <p className="text-white/70 text-xs leading-tight truncate">Management System</p>
        </div>
      </div>

      {/* DOING group */}
      <nav className="flex-1 px-2 py-4 space-y-6 overflow-y-auto" aria-label="Main navigation">
        <div>
          <p className="px-3 mb-1 text-[10px] font-semibold tracking-widest text-white/50 uppercase select-none">DOING</p>
          <div className="space-y-0.5">{doing.map(renderItem)}</div>
        </div>
        {/* VIEWING group */}
        <div>
          <p className="px-3 mb-1 text-[10px] font-semibold tracking-widest text-white/50 uppercase select-none">VIEWING</p>
          <div className="space-y-0.5">{viewing.map(renderItem)}</div>
        </div>
      </nav>

      {/* Footer — identity + sign out */}
      <div className="px-4 py-4 border-t border-white/10 space-y-1">
        <p className="text-white/80 text-sm font-medium truncate">{userName}</p>
        <p className="text-white/50 text-xs truncate">{entityName}</p>
        <SignOutButton className="mt-2 flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors duration-150 min-h-[36px]" />
      </div>
    </aside>
  )
}

// ── Mobile bottom-bar ─────────────────────────────────────────────────────────

function BottomBar({
  doing, onMore,
}: {
  doing: NavItem[]; onMore: () => void
}) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname === href || pathname.startsWith(href + '/')

  // Bottom bar shows: built doing-items + More
  const barItems = doing.filter(i => i.built)

  return (
    <nav
      className="md:hidden flex-shrink-0 h-16 bg-white border-t border-gray-200 flex items-stretch"
      aria-label="Tab navigation"
    >
      {barItems.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors duration-150 ${
            isActive(item.href) ? 'text-navy-vivid' : 'text-gray-500'
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
      {/* More tab */}
      <button
        onClick={onMore}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-gray-500 hover:text-gray-700 transition-colors duration-150"
        aria-label="More options"
      >
        <IconMore />
        <span>More</span>
      </button>
    </nav>
  )
}

// ── More sheet (mobile) ───────────────────────────────────────────────────────

function MoreSheet({
  viewing, userName, entityName, onClose,
}: {
  viewing: NavItem[]; userName: string; entityName: string; onClose: () => void
}) {
  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl px-4 pt-4 pb-8 shadow-2xl">
        {/* Drag handle */}
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

        {/* Identity */}
        <div className="mb-4 pb-4 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">{userName}</p>
          <p className="text-xs text-gray-500">{entityName}</p>
        </div>

        {/* Viewing links */}
        <div className="space-y-1 mb-4">
          {viewing.map(item => (
            item.built ? (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="flex items-center gap-3 min-h-[44px] px-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span className="text-gray-400">{item.icon}</span>
                {item.label}
              </Link>
            ) : (
              <span
                key={item.href}
                className="flex items-center gap-3 min-h-[44px] px-2 rounded-lg text-sm font-medium text-gray-300 cursor-default select-none"
              >
                <span>{item.icon}</span>
                {item.label}
                {item.phase && <span className="ml-auto text-xs text-gray-300">{item.phase}</span>}
              </span>
            )
          ))}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <SignOutButton className="flex items-center gap-3 min-h-[44px] px-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 w-full" />
        </div>
      </div>
    </div>
  )
}

// ── Shell (export) ────────────────────────────────────────────────────────────

interface Props {
  entityCode: string
  entityName: string
  userName:   string
  children:   React.ReactNode
}

export default function ManagerShell({ entityCode, entityName, userName, children }: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const { doing, viewing } = buildNavItems(entityCode)

  const openMore  = useCallback(() => setMoreOpen(true),  [])
  const closeMore = useCallback(() => setMoreOpen(false), [])

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <Sidebar
        doing={doing}
        viewing={viewing}
        userName={userName}
        entityName={entityName}
        onNavigate={closeMore}
      />

      {/* Content + mobile bottom bar */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <div className="flex-1 min-h-0 overflow-auto">
          {children}
        </div>

        <BottomBar doing={doing} onMore={openMore} />
      </div>

      {/* More sheet (mobile only) */}
      {moreOpen && (
        <MoreSheet
          viewing={viewing}
          userName={userName}
          entityName={entityName}
          onClose={closeMore}
        />
      )}
    </div>
  )
}
