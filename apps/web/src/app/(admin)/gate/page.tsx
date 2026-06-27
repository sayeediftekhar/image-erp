import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import GateClient from './GateClient'
import type { EntityRow, OverrideRow } from './types'

export default async function GatePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: entities }, { data: overrides }] = await Promise.all([
    supabase
      .from('entities')
      .select('id, code, name, go_live_month')
      .order('code'),
    supabase
      .from('month_gate_override')
      .select('id, entity_id, gated_month, granted_by, granted_at, note, entities(name)')
      .order('gated_month', { ascending: false }),
  ])

  // Flatten the joined entity name
  const flatOverrides: OverrideRow[] = (overrides ?? []).map((r: Record<string, unknown>) => ({
    id:          r.id as string,
    entity_id:   r.entity_id as string,
    gated_month: r.gated_month as string,
    granted_by:  r.granted_by as string,
    granted_at:  r.granted_at as string,
    note:        r.note as string | null,
    entity_name: (r.entities as { name: string } | null)?.name ?? '—',
  }))

  return (
    <GateClient
      entities={(entities ?? []) as EntityRow[]}
      overrides={flatOverrides}
    />
  )
}
