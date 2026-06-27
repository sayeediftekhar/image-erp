import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { classifyDays, getDhakaToday } from '@/lib/revenue/classify'
import { checkGateForMonth } from '@/lib/revenue/gate'
import RevenueManagementClient from './RevenueManagementClient'

interface Props {
  searchParams: { month?: string }
}

export default async function RevenuePage({ searchParams }: Props) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id')
    .eq('id', user.id)
    .single()

  if (!appUser || appUser.role !== 'ENTRY' || !appUser.entity_id) redirect('/home')

  // ── Resolve month ──────────────────────────────────────────────────────────
  // todayDhaka resolved server-side: never the browser clock.
  const todayDhaka = getDhakaToday()
  const [todayY, todayM] = todayDhaka.split('-').map(Number)

  let year: number, month: number
  const monthParam = searchParams?.month
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [py, pm] = monthParam.split('-').map(Number)
    year  = py
    month = pm
  } else {
    year  = todayY
    month = todayM
  }

  // ── Fetch revenue_days for entity+month via Supabase client (RLS enforces entity) ──
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const daysInMonth = new Date(year, month, 0).getDate()
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

  const { data: rows } = await supabase
    .from('revenue_day')
    .select('id, revenue_date, status, total_revenue')
    .eq('entity_id', appUser.entity_id)
    .gte('revenue_date', startDate)
    .lte('revenue_date', endDate)

  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  const days = classifyDays(rows ?? [], todayDhaka, year, month)

  // ── Gate check — pass gateInfo to calendar for locked tiles + banner ───────
  // Non-null gateInfo = this month is gated: show locked treatment + nudge.
  // Viewing is never blocked; only enterable tiles are affected.
  const gateResult = await checkGateForMonth(
    supabase, appUser.entity_id, monthStr, todayDhaka, appUser.role,
  )
  const gateInfo = gateResult.allowed
    ? null
    : { priorMonth: gateResult.priorMonth, missingCount: gateResult.missingCount }

  return (
    <RevenueManagementClient
      days={days}
      todayDhaka={todayDhaka}
      month={monthStr}
      entityId={appUser.entity_id}
      gateInfo={gateInfo}
    />
  )
}
