import { redirect } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import SignOutButton from './SignOutButton'

const ROLE_LABEL: Record<string, string> = {
  ADMIN:      'Administrator',
  HQ_FINANCE: 'HQ Finance',
  ENTRY:      'Entry (Clinic Manager)',
  READ_ONLY:  'Read-only',
}

export default async function HomePage() {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('full_name, role, entity_id')
    .eq('id', user.id)
    .single()

  // Admin shouldn't land here — send them to the panel.
  if (appUser?.role === 'ADMIN') redirect('/accounts')

  // Resolve clinic name for ENTRY users.
  let entityLabel: string | null = null
  if (appUser?.entity_id) {
    const { data: entity } = await supabase
      .from('entities')
      .select('code, name')
      .eq('id', appUser.entity_id)
      .single()
    if (entity) entityLabel = `${entity.code} — ${entity.name}`
  }

  const displayName = appUser?.full_name ?? user.email ?? 'User'
  const roleLabel   = appUser?.role ? (ROLE_LABEL[appUser.role] ?? appUser.role) : null

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">

      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 md:px-6 py-3 shadow-sm"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}>
        <div className="rounded-full bg-white p-1.5 w-10 h-10 flex items-center justify-center flex-shrink-0">
          <Image
            src="/image-logo.png"
            alt="IMAGE"
            width={28}
            height={28}
            className="object-contain"
          />
        </div>
        <span className="text-white font-semibold text-base leading-tight select-none">
          IMAGE Management System
        </span>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md border border-gray-200 w-full max-w-md p-8 space-y-6">

          {/* User info */}
          <div className="space-y-1">
            <p className="text-lg font-semibold text-gray-900">{displayName}</p>
            {roleLabel && (
              <p className="text-sm text-gray-500">Role: {roleLabel}</p>
            )}
            {entityLabel && (
              <p className="text-sm text-gray-500">Clinic: {entityLabel}</p>
            )}
          </div>

          {/* Message */}
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-4 text-sm text-blue-900 leading-relaxed">
            Your workspace is being set up — manager features are coming soon.
          </div>

          {/* Sign out */}
          <div className="pt-2">
            <SignOutButton />
          </div>

        </div>
      </main>

    </div>
  )
}
