import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { pool } from '@/lib/db/pool'
import { LedgerService, RevenueService } from '@image-erp/posting-engine'
import { assertEntityAccess, EntityAccessError } from '@/lib/revenue/close-balance'

const BodySchema = z.object({
  deliveryBalanceId: z.string().uuid('deliveryBalanceId must be a valid UUID'),
  finalBill: z.object({
    service_charge:   z.number().min(0),
    seat_rent:        z.number().min(0).default(0),
    rdf_amount:       z.number().min(0).default(0),
    logistics_amount: z.number().min(0).default(0),
  }),
  dischargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dischargeDate must be YYYY-MM-DD'),
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

  const { deliveryBalanceId, finalBill, dischargeDate } = parsed.data

  // ── 3. Fetch delivery_balance for entity authz (issue #6) ──────────────────
  let balanceRow: { entity_id: string; status: string } | null = null
  try {
    const { rows } = await pool.query<{ entity_id: string; status: string }>(
      'SELECT entity_id, status FROM public.delivery_balance WHERE id = $1',
      [deliveryBalanceId],
    )
    balanceRow = rows[0] ?? null
  } catch (err) {
    console.error('[close-balance] db fetch', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!balanceRow) {
    return NextResponse.json({ error: 'Delivery balance not found' }, { status: 404 })
  }

  // ── 4. Entity-scoped authorisation (issue #6) ──────────────────────────────
  // ENTRY: caller's entity must match the balance's entity.
  // ADMIN / HQ_FINANCE: bypass (they can close any entity's balance).
  try {
    assertEntityAccess(appUser.role, appUser.entity_id ?? null, balanceRow.entity_id)
  } catch (err) {
    if (err instanceof EntityAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    throw err
  }

  // ── 5. Idempotency pre-check ────────────────────────────────────────────────
  if (balanceRow.status !== 'OPEN') {
    return NextResponse.json(
      { error: 'Delivery balance is already closed', code: 'ALREADY_CLOSED' },
      { status: 409 },
    )
  }

  // ── 6. Close via engine ────────────────────────────────────────────────────
  try {
    const ledger  = new LedgerService(pool)
    const revenue = new RevenueService(pool, ledger)
    const result  = await revenue.closeDeliveryBalance(
      deliveryBalanceId,
      finalBill,
      dischargeDate,
      user.id,
    )
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    // Engine's total-bill > 0 guard
    if (msg.includes('total bill must be > 0')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    // Engine's idempotency guard (belt-and-suspenders; pre-checked above)
    if (msg.includes('already') && msg.toLowerCase().includes('closed')) {
      return NextResponse.json({ error: msg, code: 'ALREADY_CLOSED' }, { status: 409 })
    }

    console.error('[close-balance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
