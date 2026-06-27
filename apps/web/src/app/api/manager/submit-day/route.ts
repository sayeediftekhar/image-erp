import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { pool } from '@/lib/db/pool'
import { LedgerService, RevenueService } from '@image-erp/posting-engine'
import { getDhakaToday } from '@/lib/revenue/classify'
import { checkGateForMonth } from '@/lib/revenue/gate'

const BodySchema = z.object({
  revenueDayId: z.string().uuid('revenueDayId must be a valid UUID'),
  entityId:     z.string().uuid().optional(), // for ADMIN/HQ_FINANCE
})

export async function POST(request: Request) {
  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { data: appUser } = await supabase
    .from('app_users')
    .select('role, entity_id, active')
    .eq('id', user.id)
    .single()

  if (!appUser || !appUser.active) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!['ENTRY', 'ADMIN', 'HQ_FINANCE'].includes(appUser.role)) {
    return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 },
    )
  }

  const { revenueDayId, entityId: bodyEntityId } = parsed.data

  // ── 3. Resolve entityId (entity isolation) ─────────────────────────────────
  // ENTRY: always the authenticated user's own entity — body entityId ignored.
  // ADMIN/HQ_FINANCE: accept from body.
  let callerEntityId: string
  if (appUser.role === 'ENTRY') {
    if (!appUser.entity_id) {
      return NextResponse.json({ error: 'ENTRY user has no entity assigned' }, { status: 403 })
    }
    callerEntityId = appUser.entity_id
  } else {
    if (!bodyEntityId) {
      return NextResponse.json({ error: 'entityId required' }, { status: 400 })
    }
    callerEntityId = bodyEntityId
  }

  // ── 4. Fetch revenue_day — entity isolation check ─────────────────────────
  // revenue_date::text cast required (LEARNINGS: pg date→JS Date by default;
  // cast to text to keep it as YYYY-MM-DD string for the gate check below).
  let row: { id: string; entity_id: string; status: string; revenue_date: string } | null = null
  try {
    const { rows } = await pool.query<{
      id: string; entity_id: string; status: string; revenue_date: string
    }>(
      'SELECT id, entity_id, status, revenue_date::text AS revenue_date FROM public.revenue_day WHERE id = $1',
      [revenueDayId],
    )
    row = rows[0] ?? null
  } catch (err) {
    console.error('[submit-day] db fetch', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!row) {
    return NextResponse.json({ error: 'Day not found' }, { status: 404 })
  }
  if (appUser.role === 'ENTRY' && row.entity_id !== callerEntityId) {
    return NextResponse.json({ error: 'Forbidden — entity mismatch' }, { status: 403 })
  }
  if (row.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Day is already submitted', code: 'ALREADY_SUBMITTED' },
      { status: 409 },
    )
  }

  // ── 4b. Gate check (ENTRY only — backstop) ─────────────────────────────────
  // todayDhaka is server-resolved (Asia/Dhaka) — a spoofed client cannot bypass
  // the grace window by supplying a manipulated date.
  if (appUser.role === 'ENTRY') {
    const todayDhaka = getDhakaToday()
    const monthN     = row.revenue_date.slice(0, 7)
    const gateResult = await checkGateForMonth(supabase, callerEntityId, monthN, todayDhaka, 'ENTRY')
    if (!gateResult.allowed) {
      return NextResponse.json(
        { error: 'Submit blocked — resolve prior month first', code: 'GATE_BLOCKED' },
        { status: 403 },
      )
    }
  }

  // ── 5. Submit via engine ───────────────────────────────────────────────────
  try {
    const ledgerService  = new LedgerService(pool)
    const revenueService = new RevenueService(pool, ledgerService)
    const result = await revenueService.submitRevenueDay(revenueDayId, user.id)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    // Engine's idempotency guard (belt-and-suspenders, already checked above)
    if (msg.includes('already') && msg.toLowerCase().includes('submitted')) {
      return NextResponse.json({ error: msg, code: 'ALREADY_SUBMITTED' }, { status: 409 })
    }

    // Zod validation error from engine's DraftDataSchema.parse
    if (err != null && typeof err === 'object' && 'issues' in err) {
      return NextResponse.json({ error: 'Draft data validation failed: ' + msg }, { status: 400 })
    }

    console.error('[submit-day]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
