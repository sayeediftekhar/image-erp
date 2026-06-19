import { redirect } from 'next/navigation'

// Root "/" redirects straight to /accounts (the first admin panel page).
// Middleware intercepts first: unauthenticated visitors are redirected to /login.
export default function RootPage() {
  redirect('/accounts')
}
