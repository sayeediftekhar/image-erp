import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEntityCapabilities } from '@/lib/capabilities'
import { getDhakaToday } from '@/lib/revenue/classify'
import WizardClient from './WizardClient'

interface Props {
  searchParams: { date?: string }
}

export default async function WizardPage({ searchParams }: Props) {
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

  // Validate + bound-check the date param
  const date = searchParams?.date ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect('/revenue')
  const todayDhaka = getDhakaToday()
  if (date > todayDhaka) redirect('/revenue')

  // Fetch entity name + capabilities
  const { data: entity } = await supabase
    .from('entities')
    .select('code, name')
    .eq('id', appUser.entity_id)
    .single()
  if (!entity) redirect('/home')

  const caps = getEntityCapabilities(entity.code)

  // Fetch existing draft for this date (if any)
  const { data: rows } = await supabase
    .from('revenue_day')
    .select('id, status, draft_data')
    .eq('entity_id', appUser.entity_id)
    .eq('revenue_date', date)
    .limit(1)

  const dayRow = rows?.[0] ?? null

  // Submitted days are read-only — redirect to the view page rather than the wizard
  if (dayRow && dayRow.status !== 'DRAFT') redirect(`/revenue/day/${date}`)

  // opening_cash (a): carry-forward from the most-recent prior SUBMITTED day.
  // NUMERIC-as-string guard: Number() on the JSONB value.
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
    <WizardClient
      date={date}
      entityCode={entity.code}
      entityName={entity.name}
      caps={caps}
      initialDraft={dayRow?.draft_data ?? null}
      revenueDayId={dayRow?.id ?? null}
      openingCash={openingCash}
    />
  )
}
