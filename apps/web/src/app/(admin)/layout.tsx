import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Logo from './Logo'
import SideNav from './SideNav'
import HeaderBar from './HeaderBar'

// AdminShellLayout wraps every page in the (admin) route group.
// Runs getUser() server-side (validates JWT against Supabase Auth — never getSession()).
// Renders: navy sidebar (logo + nav) | right column (header + page content).
export default async function AdminShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id')
    .eq('id', user.id)
    .single()

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 bg-navy-deep flex flex-col">
        {/* Logo + wordmark */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
          <Logo />
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-tight">IMAGE</p>
            <p className="text-white/70 text-xs leading-tight truncate">Management System</p>
          </div>
        </div>

        {/* Nav — client component (needs usePathname for active state) */}
        <SideNav />

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 flex-shrink-0">
          <p className="text-white/40 text-xs">Phase 1 · v0.1</p>
        </div>
      </aside>

      {/* ── Right panel ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header — client component (needs usePathname for page title) */}
        <HeaderBar email={user.email ?? ''} role={appUser?.role ?? 'Unknown'} />

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
