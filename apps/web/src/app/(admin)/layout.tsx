import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminShell from './AdminShell'

// Server Component: validates session, fetches role, hands off to AdminShell (client).
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
    <AdminShell email={user.email ?? ''} role={appUser?.role ?? 'Unknown'}>
      {children}
    </AdminShell>
  )
}
