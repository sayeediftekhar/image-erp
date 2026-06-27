import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const GrantSchema = z.object({
  entityId:   z.string().uuid('entityId must be a valid UUID'),
  gatedMonth: z.string().regex(/^\d{4}-\d{2}$/, 'gatedMonth must be YYYY-MM'),
  note:       z.string().max(500).nullable().optional(),
})

const RevokeSchema = z.object({
  entityId:   z.string().uuid(),
  gatedMonth: z.string().regex(/^\d{4}-\d{2}$/),
})

// ── Shared admin auth guard ───────────────────────────────────────────────────

async function verifyAdmin(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, active')
    .eq('id', user.id)
    .single()

  if (!appUser || appUser.role !== 'ADMIN' || !appUser.active) return null
  return user
}

// ── POST — grant / upsert override ───────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = createClient()
  const admin    = await verifyAdmin(supabase)
  if (!admin) return NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = GrantSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 },
    )
  }

  const { entityId, gatedMonth, note } = parsed.data

  // UPSERT: re-granting the same entity+month updates granted_by/granted_at/note.
  // Uses admin's session (gate_override_admin RLS policy allows ADMIN writes).
  const { error } = await supabase
    .from('month_gate_override')
    .upsert(
      {
        entity_id:   entityId,
        gated_month: gatedMonth,
        granted_by:  admin.id,
        granted_at:  new Date().toISOString(),
        note:        note ?? null,
        created_by:  admin.id,
      },
      { onConflict: 'entity_id,gated_month' },
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}

// ── DELETE — revoke override ──────────────────────────────────────────────────

export async function DELETE(request: Request) {
  const supabase = createClient()
  const admin    = await verifyAdmin(supabase)
  if (!admin) return NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = RevokeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 },
    )
  }

  const { entityId, gatedMonth } = parsed.data

  const { error } = await supabase
    .from('month_gate_override')
    .delete()
    .eq('entity_id', entityId)
    .eq('gated_month', gatedMonth)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
