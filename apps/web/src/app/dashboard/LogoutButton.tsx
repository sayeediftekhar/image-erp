'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        padding: '0.5rem 1rem',
        background: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        fontSize: '0.875rem',
        cursor: 'pointer',
      }}
    >
      Sign out
    </button>
  )
}
