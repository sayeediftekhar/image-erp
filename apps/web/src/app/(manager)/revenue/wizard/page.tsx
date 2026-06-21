import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

interface Props {
  searchParams: { date?: string }
}

export default async function WizardPlaceholderPage({ searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const date = searchParams?.date ?? '(unknown date)'

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(145deg, #07043a 0%, #0F0A52 55%, #1a0c7a 100%)' }}
    >
      <header className="px-4 pt-5 pb-4">
        <p className="text-white/60 text-xs font-medium uppercase tracking-widest mb-1">
          Revenue Entry
        </p>
        <h1 className="text-white text-2xl font-bold leading-tight">Day Entry</h1>
        <p className="text-white/70 text-sm mt-1">{date}</p>
      </header>

      <div className="flex-1 bg-gray-50 rounded-t-3xl flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div
            className="w-16 h-16 rounded-full mx-auto flex items-center justify-center"
            style={{ background: '#0F0A52' }}
          >
            <span className="text-white text-2xl">🚧</span>
          </div>
          <h2 className="text-gray-900 text-xl font-bold">Coming next</h2>
          <p className="text-gray-500 text-sm leading-relaxed">
            The day-entry wizard (T3b) is under construction.
            Check back soon.
          </p>
          <a
            href="/revenue"
            className="block mt-6 min-h-[44px] flex items-center justify-center text-sm font-semibold text-white rounded-xl px-6 py-3"
            style={{ background: '#13007D' }}
          >
            ← Back to monthly view
          </a>
        </div>
      </div>
    </div>
  )
}
