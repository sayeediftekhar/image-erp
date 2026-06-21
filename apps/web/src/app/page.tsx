import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Root "/" dispatches by role: ADMIN→/accounts, everyone else→/home.
// Middleware handles unauthenticated visitors (→/login) before this runs.
export default async function RootPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (appUser?.role === 'ADMIN')       redirect('/accounts')
  else if (appUser?.role === 'ENTRY') redirect('/revenue')
  else                                redirect('/home')
}
