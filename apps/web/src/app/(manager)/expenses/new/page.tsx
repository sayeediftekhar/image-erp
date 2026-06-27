import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ExpenseForm from '../ExpenseForm'

export default async function NewExpensePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id, active')
    .eq('id', user.id)
    .single()

  if (!appUser || !appUser.active) redirect('/login')
  if (!['ENTRY', 'ADMIN', 'HQ_FINANCE'].includes(appUser.role)) redirect('/login')

  const entityId = appUser.entity_id as string | null

  let entityName = ''
  if (entityId) {
    const { data: entity } = await supabase
      .from('entities')
      .select('name')
      .eq('id', entityId)
      .single()
    entityName = entity?.name ?? ''
  }

  return (
    <div className="min-h-full flex flex-col">
      {/* Header */}
      <div
        className="px-4 pt-5 pb-6 shrink-0"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
      >
        <Link
          href="/expenses"
          className="inline-flex items-center gap-1.5 text-white/60 text-xs font-medium mb-3 hover:text-white/90 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Expenses
        </Link>
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">Expenses</p>
        <h1 className="text-white text-2xl font-bold leading-tight">Post Expense</h1>
      </div>

      {/* Scrollable form area */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl -mt-3 overflow-y-auto">
        <ExpenseForm
          entityId={entityId ?? ''}
          entityName={entityName}
          userId={user.id}
          redirectTo="/expenses"
        />
      </div>
    </div>
  )
}
