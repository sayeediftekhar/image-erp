import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReviewStep from '../../wizard/ReviewStep'

interface Props {
  params: { date: string }
}

export default async function SubmittedDayPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id, active')
    .eq('id', user.id)
    .single()

  if (!appUser?.active || appUser.role !== 'ENTRY') redirect('/home')
  if (!appUser.entity_id) redirect('/home')

  const date = params.date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect('/revenue')

  const { data: entity } = await supabase
    .from('entities')
    .select('code, name')
    .eq('id', appUser.entity_id)
    .single()
  if (!entity) redirect('/home')

  // Must be a SUBMITTED day owned by this entity
  const { data: dayRow } = await supabase
    .from('revenue_day')
    .select('id, status, draft_data')
    .eq('entity_id', appUser.entity_id)
    .eq('revenue_date', date)
    .single()

  if (!dayRow || dayRow.status !== 'SUBMITTED') redirect('/revenue')

  // opening_cash: carry-forward from the most-recent prior SUBMITTED day's counted cash.
  // NUMERIC-as-string guard: parse with Number() before passing to client component.
  const { data: priorDay } = await supabase
    .from('revenue_day')
    .select('draft_data')
    .eq('entity_id', appUser.entity_id)
    .eq('status', 'SUBMITTED')
    .lt('revenue_date', date)
    .order('revenue_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const priorFinancial = (priorDay?.draft_data as Record<string, unknown> | null)
    ?.financial as Record<string, unknown> | undefined
  const openingCash = Number(priorFinancial?.cash_in_hand_counted ?? 0) || 0

  return (
    <div
      className="min-h-full flex flex-col"
      style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
    >
      {/* Header */}
      <header className="px-4 pt-5 pb-3 shrink-0">
        <a
          href="/revenue"
          className="text-white/60 text-sm font-medium min-h-[44px] flex items-center gap-1"
        >
          ← Day list
        </a>
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mt-1">{entity.name}</p>
        <h1 className="text-white text-2xl font-bold leading-tight mt-0.5">Day Entry</h1>
        <div className="mt-1 inline-block rounded-full bg-green-500/20 border border-green-400/40 px-3 py-0.5">
          <span className="text-green-300 text-xs font-semibold">Submitted</span>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 bg-gray-50 rounded-t-3xl overflow-auto">
        <ReviewStep
          draftData={dayRow.draft_data as Record<string, unknown>}
          openingCash={openingCash}
          date={date}
          entityName={entity.name}
          readOnly={true}
        />
      </div>
    </div>
  )
}
