'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setPassword('')
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        width: '340px',
        background: '#fff',
        padding: '2rem',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>IMAGE ERP</h1>
        <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
          Sign in to continue
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <label htmlFor="email" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="email"
          style={{
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '0.875rem',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <label htmlFor="password" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          style={{
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '0.875rem',
          }}
        />
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, color: '#dc2626', fontSize: '0.875rem' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{
          padding: '0.625rem',
          background: loading ? '#93c5fd' : '#1d4ed8',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontSize: '0.875rem',
          fontWeight: 500,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
