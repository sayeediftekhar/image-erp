'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const [logoErr, setLogoErr]   = useState(false)

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

    // Fetch role to send ADMIN→panel, everyone else→landing.
    const { data: { user } } = await supabase.auth.getUser()
    const { data: appUser } = user
      ? await supabase.from('app_users').select('role').eq('id', user.id).single()
      : { data: null }

    if (appUser?.role === 'ADMIN')       router.push('/accounts')
    else if (appUser?.role === 'ENTRY') router.push('/revenue')
    else                                router.push('/home')
    router.refresh()
  }

  return (
    <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-sm">
      {/* Logo + product name */}
      <div className="flex flex-col items-center gap-3 mb-8">
        {logoErr ? (
          <div className="w-16 h-16 rounded-full bg-navy-deep flex items-center justify-center">
            <span className="text-white font-bold text-lg select-none">IE</span>
          </div>
        ) : (
          <Image
            src="/image-logo.png"
            alt="IMAGE"
            width={64}
            height={64}
            className="object-contain"
            onError={() => setLogoErr(true)}
            priority
          />
        )}
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 leading-tight">IMAGE Management System</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-4 focus:ring-navy-vivid/30 focus:border-navy-vivid transition-all duration-200"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 text-base font-semibold text-white bg-navy-vivid rounded-lg hover:bg-navy-deep focus:outline-none focus:ring-4 focus:ring-navy-vivid/50 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
