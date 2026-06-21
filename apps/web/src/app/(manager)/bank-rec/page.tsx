import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function BankRecPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-full flex flex-col">
      <div
        className="px-4 pt-5 pb-6"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
      >
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">Bank Reconciliation</p>
        <h1 className="text-white text-2xl font-bold leading-tight">Bank Rec</h1>
      </div>

      <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 flex items-center justify-center px-6 py-12">
        <div className="max-w-sm w-full text-center space-y-3">
          <div
            className="w-14 h-14 rounded-full mx-auto flex items-center justify-center"
            style={{ background: '#0F0A52' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
            </svg>
          </div>
          <p className="text-gray-900 font-semibold text-lg">Bank Reconciliation</p>
          <p className="text-gray-400 text-sm leading-relaxed">
            Your clinic's bank reconciliation will be available in Phase 5, released
            when the month is marked ready by HQ.
          </p>
        </div>
      </div>
    </div>
  )
}
