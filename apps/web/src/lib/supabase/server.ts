import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Used in Server Components, Server Actions, and Route Handlers.
// Session refresh is handled by middleware; the try/catch in setAll handles the case
// where this factory is called from a Server Component render (cookies are read-only there).
export const createClient = () => {
  const cookieStore = cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component; cookie writes are a no-op here.
            // Middleware handles session refresh on every request.
          }
        },
      },
    },
  )
}
