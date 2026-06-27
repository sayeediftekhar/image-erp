import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { pool } from '@/lib/db/pool'
import { LedgerService } from '@image-erp/posting-engine'
import { getDhakaToday } from '@/lib/revenue/classify'
import {
  deriveRoutedAccount,
  deriveSourceAccount,
  deriveTransferCashAccount,
  lineFund,
} from '@/lib/expense/routing'

// Transfer SEND/RECEIVE models the simple single-entity case: the entity
// moves its own cash/bank to/from the 1410/2210 inter-entity clearing account.
// The two-sided case (HQ directly pays a clinic) is handled manually outside
// the form.
const BodySchema = z.object({
  fund:          z.enum(['PI', 'RDF', 'TRANSFER']),
  selectionKey:  z.string().min(1, 'Category / stream / direction required'),
  // source required for PI/RDF; for TRANSFER it is 'BANK'|'CASH' (petty cash excluded)
  source:        z.string().min(1, 'Source of funds required'),
  amount:        z.number().positive('Amount must be greater than 0'),
  purchaseDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'purchaseDate must be YYYY-MM-DD'),
  paymentDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vendor:        z.string().min(1, 'Vendor is required'),
  voucherNumber: z.string().min(1, 'Voucher # is required'),
  paymentMethod: z.enum(['PETTY_CASH', 'CHEQUE', 'BANK_TRANSFER', 'CASH']),
  chequeNumber:  z.string().optional(),
  note:          z.string().optional(),
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
  if (appUser.role === 'ENTRY' && !appUser.entity_id) {
    return NextResponse.json({ error: 'ENTRY user has no entity assigned' }, { status: 403 })
  }

  const callerEntityId = (appUser.role === 'ENTRY'
    ? appUser.entity_id
    : null) as string | null

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let rawBody: unknown
  try { rawBody = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Validation failed' },
      { status: 400 },
    )
  }

  const {
    fund, selectionKey, source, amount,
    purchaseDate, paymentDate, vendor,
    voucherNumber, paymentMethod, chequeNumber, note,
  } = parsed.data

  // ── 3. Validate cheque# requirement ───────────────────────────────────────
  if (paymentMethod === 'CHEQUE' && !chequeNumber?.trim()) {
    return NextResponse.json(
      { error: 'Cheque # is required when payment method is Cheque' },
      { status: 400 },
    )
  }

  // ── 4. Validate purchaseDate is not in the future ─────────────────────────
  const todayDhaka = getDhakaToday()
  if (purchaseDate > todayDhaka) {
    return NextResponse.json(
      { error: 'Purchase date cannot be in the future' },
      { status: 400 },
    )
  }

  // ── 5. Derive accounts by construction ────────────────────────────────────
  const routedAccount = deriveRoutedAccount(fund, selectionKey)
  if (!routedAccount) {
    return NextResponse.json(
      { error: 'Invalid category / stream / direction for this fund' },
      { status: 400 },
    )
  }

  // Law-6 backstop: RDF posting MUST debit a 12xx stock account. If the
  // client somehow sent a 5xxx account code for an RDF transaction (which the
  // UI prevents by construction), reject it here as a hard server-side guard.
  if (fund === 'RDF' && !routedAccount.startsWith('12')) {
    return NextResponse.json(
      { error: 'RDF purchase must debit a 12xx stock account (Law 6 — not a 5xxx expense)' },
      { status: 403 },
    )
  }

  let debitCode: string
  let creditCode: string

  if (fund === 'TRANSFER') {
    const cashAccount = deriveTransferCashAccount(source as 'BANK' | 'CASH')
    if (selectionKey === 'SEND') {
      // Dr 1410 / Cr [cash or PI bank]
      debitCode  = routedAccount  // '1410'
      creditCode = cashAccount
    } else {
      // Dr [cash or PI bank] / Cr 2210
      debitCode  = cashAccount
      creditCode = routedAccount  // '2210'
    }
  } else {
    const sourceAccount = deriveSourceAccount(fund as 'PI' | 'RDF', source as 'PETTY_CASH' | 'BANK' | 'CASH')
    if (!sourceAccount) {
      return NextResponse.json(
        { error: 'Invalid source of funds for this fund type' },
        { status: 400 },
      )
    }
    debitCode  = routedAccount
    creditCode = sourceAccount
  }

  // ── 6. Resolve entityId ────────────────────────────────────────────────────
  // ENTRY: always the authenticated user's own entity.
  // ADMIN/HQ_FINANCE: currently always own entity too (multi-entity override
  // is not modelled in the expense form for Phase 2).
  if (!callerEntityId && !appUser.entity_id) {
    return NextResponse.json({ error: 'No entity assigned' }, { status: 403 })
  }
  const entityId: string = callerEntityId ?? (appUser.entity_id as string)

  // ── 7. Build description ───────────────────────────────────────────────────
  const description = [
    vendor,
    note?.trim() ? `— ${note.trim()}` : null,
  ].filter(Boolean).join(' ')

  // ── 8. Post through engine (sole journal_lines writer) ────────────────────
  const entryDate = paymentDate ?? purchaseDate
  const fnd = lineFund(fund)

  try {
    const ledger = new LedgerService(pool)
    const entryId = await ledger.postTransaction(
      {
        entityId,
        entryDate,
        description,
        ref:           voucherNumber,
        chequeNumber:  chequeNumber?.trim() || undefined,
        sourceModule:  'EXPENSE',
        lines: [
          { accountCode: debitCode,  fund: fnd, debit: amount, credit: 0 },
          { accountCode: creditCode, fund: fnd, debit: 0,      credit: amount },
        ],
      },
      user.id,
    )

    // Determine the actual status from the DB (engine auto-routes PENDING_APPROVAL
    // for 1410/2210 via requires_approval=true, or for high-value entries).
    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM public.journal_entries WHERE id = $1',
      [entryId],
    )
    const status = rows[0]?.status ?? 'POSTED'

    return NextResponse.json({ entryId, status }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes('unbalanced')) {
      return NextResponse.json({ error: 'Entry unbalanced — this is a bug, please report it' }, { status: 500 })
    }
    if (err != null && typeof err === 'object' && 'issues' in err) {
      return NextResponse.json({ error: 'Validation failed: ' + msg }, { status: 400 })
    }

    console.error('[post-expense]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
