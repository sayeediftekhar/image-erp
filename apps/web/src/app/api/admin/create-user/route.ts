import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAnonClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

const CreateUserSchema = z.object({
  email:     z.string().email('Valid email required'),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
  full_name: z.string().min(1, 'Full name is required').max(255, 'Name too long'),
  role:      z.enum(['ADMIN', 'HQ_FINANCE', 'ENTRY', 'READ_ONLY']),
  entity_id: z.string().uuid('entity_id must be a valid UUID').nullable(),
}).refine(
  d => (d.role === 'ENTRY') === (d.entity_id !== null),
  { message: 'ENTRY users must have an entity; other roles must not', path: ['entity_id'] },
)

export async function POST(request: Request) {
  // ── 1. Verify caller is an active ADMIN before any privileged work ────────
  const anonClient = createAnonClient()
  const { data: { user } } = await anonClient.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 403 })
  }

  const { data: appUser } = await anonClient
    .from('app_users')
    .select('role, active')
    .eq('id', user.id)
    .single()

  if (!appUser || appUser.role !== 'ADMIN' || !appUser.active) {
    return NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 })
  }

  // ── 2. Validate request body (server-side Zod — never trust the client) ───
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = CreateUserSchema.safeParse(body)
  if (!result.success) {
    const first = result.error.issues[0]
    return NextResponse.json(
      { error: first?.message ?? 'Validation failed' },
      { status: 400 },
    )
  }

  const { email, password, full_name, role, entity_id } = result.data

  // ── 3. Construct service client (only after admin check passes) ───────────
  // Used ONLY for Auth Admin API calls (createUser, deleteUser).
  // SUPABASE_SERVICE_ROLE_KEY is a non-NEXT_PUBLIC_ env var: server-only.
  // persistSession/autoRefreshToken false = no session management in server context.
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // ── 4. Create the Supabase Auth account ───────────────────────────────────
  const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) {
    const msg = authError.message ?? ''
    // Supabase reports duplicate email as status 422 / "User already registered"
    if (
      authError.status === 422 ||
      msg.toLowerCase().includes('already') ||
      msg.toLowerCase().includes('registered') ||
      msg.toLowerCase().includes('exists')
    ) {
      return NextResponse.json(
        { error: 'That email address is already registered.' },
        { status: 422 },
      )
    }
    return NextResponse.json(
      { error: msg || 'Failed to create auth account' },
      { status: 500 },
    )
  }

  const newUserId = authData.user.id

  // ── 5. Insert app_users row via the admin's verified session (least-privilege) ──
  // anonClient carries the caller's admin JWT: app_users_admin_write RLS
  // (is_admin()=true) grants INSERT. service_role is NOT used here — it has no
  // explicit DML grant on app_users; only authenticated does.
  const { error: dbError } = await anonClient
    .from('app_users')
    .insert({ id: newUserId, full_name, role, entity_id, active: true })

  if (dbError) {
    // Best-effort cleanup: auth.admin.deleteUser still needs the service key.
    const { error: cleanupError } = await serviceClient.auth.admin.deleteUser(newUserId)

    if (cleanupError) {
      return NextResponse.json(
        {
          error:
            `User record creation failed AND auth-account cleanup failed. ` +
            `Manually delete auth user ${newUserId} from the Supabase dashboard. ` +
            `DB error: ${dbError.message}. Cleanup error: ${cleanupError.message}`,
        },
        { status: 500 },
      )
    }

    return NextResponse.json(
      { error: `Failed to create user record: ${dbError.message}` },
      { status: 500 },
    )
  }

  // ── 6. Return the created user (no password) ──────────────────────────────
  return NextResponse.json(
    { id: newUserId, full_name, role, entity_id, active: true },
    { status: 201 },
  )
}
