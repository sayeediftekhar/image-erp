import type { Metadata } from 'next'
import LoginForm from './LoginForm'

export const metadata: Metadata = { title: 'Sign in — IMAGE ERP' }

export default function LoginPage() {
  return (
    <main
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: '#f9fafb',
      }}
    >
      <LoginForm />
    </main>
  )
}
