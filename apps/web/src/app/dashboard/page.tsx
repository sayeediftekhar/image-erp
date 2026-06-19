import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from './LogoutButton'

interface AppUser {
  role: string
  entity_id: string | null
}

export default async function DashboardPage() {
  const supabase = createClient()

  // Always use getUser() on the server — validates the JWT against Supabase Auth.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Read the caller's own row via RLS (app_users_self_read policy: id = auth.uid()).
  // Returns role + entity_id — enough to confirm end-to-end identity resolution.
  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id')
    .eq('id', user.id)
    .single<AppUser>()

  return (
    <main style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.5rem' }}>
        IMAGE ERP — Dashboard
      </h1>

      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '8px',
          padding: '1rem 1.25rem',
          marginBottom: '1.5rem',
        }}
      >
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
          Signed in as
        </p>
        <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>{user.email}</p>
        {appUser ? (
          <p style={{ margin: 0, fontSize: '0.875rem' }}>
            Role: <strong>{appUser.role}</strong>
            {appUser.entity_id
              ? ` · Entity: ${appUser.entity_id}`
              : ' · Scope: all entities'}
          </p>
        ) : (
          <p style={{ margin: 0, color: '#dc2626', fontSize: '0.875rem' }}>
            ⚠ No app_users row found for this account. Run the bootstrap admin runbook.
          </p>
        )}
      </div>

      <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.5rem' }}>
        This is the placeholder dashboard. The admin panel (T8) will live here.
      </p>

      <LogoutButton />
    </main>
  )
}
