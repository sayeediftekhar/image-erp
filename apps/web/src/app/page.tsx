import { redirect } from 'next/navigation'

// Root "/" redirects to /dashboard.
// Middleware intercepts first: unauthenticated visitors are sent to /login before reaching here.
export default function RootPage() {
  redirect('/dashboard')
}
