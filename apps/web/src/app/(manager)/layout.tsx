import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ManagerShell from './ManagerShell'

// Server Component: validates session + role gates, then renders the persistent shell.
// ADMIN → /accounts; non-ENTRY → /home (unchanged from T3a).
// Shell receives entity name/code for nav adaptation and identity header.
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
    .select('role, entity_id, full_name')
    .eq('id', user.id)
    .single()

  if (appUser?.role === 'ADMIN') redirect('/accounts')
  if (appUser?.role !== 'ENTRY') redirect('/home')

  // Resolve clinic name for header identity and nav adaptation.
  // Null-safe: entity_id should always be set for ENTRY, but don't crash if not.
  let entityCode = ''
  let entityName = 'Your clinic'
  if (appUser?.entity_id) {
    const { data: entity } = await supabase
      .from('entities')
      .select('code, name')
      .eq('id', appUser.entity_id)
      .single()
    if (entity) {
      entityCode = entity.code
      entityName = entity.name
    }
  }

  const userName = appUser?.full_name ?? user.email ?? 'Manager'

  return (
    <ManagerShell entityCode={entityCode} entityName={entityName} userName={userName}>
      {children}
    </ManagerShell>
  )
}
