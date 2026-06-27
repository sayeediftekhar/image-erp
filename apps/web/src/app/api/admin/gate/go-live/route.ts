import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const GoLiveSchema = z.object({
  entityId:    z.string().uuid('entityId must be a valid UUID'),
  goLiveMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'goLiveMonth must be YYYY-MM')
    .nullable(),
})

export async function PATCH(request: Request) {
  // ── 1. Verify caller is an active ADMIN ───────────────────────────────────
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, active')
    .eq('id', user.id)
    .single()

  if (!appUser || appUser.role !== 'ADMIN' || !appUser.active) {
    return NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 })
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = GoLiveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 },
    )
  }

  const { entityId, goLiveMonth } = parsed.data

  // ── 3. Update entities.go_live_month via admin's session (RLS covers write) ─
  const { error } = await supabase
    .from('entities')
    .update({ go_live_month: goLiveMonth, updated_by: user.id })
    .eq('id', entityId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
