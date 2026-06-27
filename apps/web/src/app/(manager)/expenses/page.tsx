import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ExpenseForm from './ExpenseForm'

export default async function ExpensesPage() {
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

  const entityId = appUser.entity_id as string

  // Fetch entity name for display
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
      <div
        className="px-4 pt-5 pb-6"
        style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
      >
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">Expenses</p>
        <h1 className="text-white text-2xl font-bold leading-tight">Expense Entry</h1>
      </div>

      <ExpenseForm
        entityId={entityId}
        entityName={entityName}
        userId={user.id}
      />
    </div>
  )
}
