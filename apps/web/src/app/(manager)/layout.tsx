import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Server Component: validates session + gates to ENTRY role.
// ADMIN → their panel (/accounts); everyone else non-ENTRY → /home.
// Unauthenticated → /login (no protected-content flash — server-side only).
export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id')
    .eq('id', user.id)
    .single()

  if (appUser?.role === 'ADMIN') redirect('/accounts')
  if (appUser?.role !== 'ENTRY') redirect('/home')

  return <>{children}</>
}
