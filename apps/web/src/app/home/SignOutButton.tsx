'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton() {
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
      className="min-h-[44px] px-6 text-base font-medium text-navy-vivid border border-navy-vivid/40 rounded-lg hover:bg-navy-vivid/10 focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 transition-all duration-200"
    >
      Sign out
    </button>
  )
}
