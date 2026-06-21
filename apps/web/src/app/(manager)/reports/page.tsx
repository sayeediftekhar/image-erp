import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function ReportsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-full flex flex-col">
      <div
        className="px-4 pt-5 pb-6"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
      >
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">Reports</p>
        <h1 className="text-white text-2xl font-bold leading-tight">Clinic Reports</h1>
      </div>

      <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 flex items-center justify-center px-6 py-12">
        <div className="max-w-sm w-full text-center space-y-3">
          <div
            className="w-14 h-14 rounded-full mx-auto flex items-center justify-center"
            style={{ background: '#0F0A52' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </div>
          <p className="text-gray-900 font-semibold text-lg">Clinic Reports</p>
          <p className="text-gray-400 text-sm leading-relaxed">
            Your clinic's Income &amp; Expenditure, operational statistics, and cost-recovery
            report are coming in Phase 4.
          </p>
          <p className="text-gray-300 text-xs">
            Consolidated and balance-sheet reports are HQ/Admin only.
          </p>
        </div>
      </div>
    </div>
  )
}
