'use client'

import { useState } from 'react'
import Logo from './Logo'
import SideNav from './SideNav'
import HeaderBar from './HeaderBar'

interface Props {
  email: string
  role:  string
  children: React.ReactNode
}

export default function AdminShell({ email, role, children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Backdrop (mobile only — closes drawer on tap) ───────────────────── */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 bg-black/50 z-20 md:hidden transition-opacity duration-200 ${
          drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      {/*   Mobile: fixed overlay drawer, slides in/out via transform.           */}
      {/*   Desktop (md+): md:static overrides fixed; md:translate-x-0 always    */}
      {/*   visible; drawer state is irrelevant at this breakpoint.              */}
      <aside
        className={`
          flex flex-col bg-navy-deep z-30
          fixed inset-y-0 left-0 w-64 transition-transform duration-200
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:z-auto md:w-56 md:flex-shrink-0
        `}
      >
        {/* Logo + wordmark */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
          <Logo />
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-tight">IMAGE</p>
            <p className="text-white/70 text-xs leading-tight truncate">Management System</p>
          </div>
        </div>

        {/* Nav */}
        <SideNav onNavigate={() => setDrawerOpen(false)} />

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 flex-shrink-0">
          <p className="text-white/40 text-xs">Phase 1 · v0.1</p>
        </div>
      </aside>

      {/* ── Right panel ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <HeaderBar
          email={email}
          role={role}
          onMenuOpen={() => setDrawerOpen(true)}
        />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
