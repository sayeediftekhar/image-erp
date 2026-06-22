import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { pool } from '@/lib/db/pool'
import { saveDraftDay, DraftSaveError } from '@/lib/revenue/save-draft'
import { getDhakaToday } from '@/lib/revenue/classify'

const BodySchema = z.object({
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  partialDraft: z.record(z.unknown()),
  entityId:     z.string().uuid().optional(), // used only for ADMIN/HQ_FINANCE
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

  const { date, partialDraft, entityId: bodyEntityId } = parsed.data

  // ── 3. Resolve entityId (entity isolation) ─────────────────────────────────
  // ENTRY: always the authenticated user's own entity — body entityId is ignored.
  // ADMIN/HQ_FINANCE: accept from body (entity picker deferred to later task).
  let entityId: string
  if (appUser.role === 'ENTRY') {
    if (!appUser.entity_id) {
      return NextResponse.json({ error: 'ENTRY user has no entity assigned' }, { status: 403 })
    }
    entityId = appUser.entity_id
  } else {
    if (!bodyEntityId) {
      return NextResponse.json({ error: 'entityId required' }, { status: 400 })
    }
    entityId = bodyEntityId
  }

  // ── 4. Guard: cannot draft a future day ───────────────────────────────────
  const todayDhaka = getDhakaToday()
  if (date > todayDhaka) {
    return NextResponse.json({ error: 'Cannot save a draft for a future day' }, { status: 400 })
  }

  // ── 5. Execute ────────────────────────────────────────────────────────────
  try {
    const result = await saveDraftDay(pool, user.id, entityId, date, partialDraft)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof DraftSaveError) {
      const status = err.code === 'ALREADY_SUBMITTED' ? 409 : 400
      return NextResponse.json({ error: err.message, code: err.code }, { status })
    }
    console.error('[save-draft]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
