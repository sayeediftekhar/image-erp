import { createClient } from '@/lib/supabase/server'
import SettingsClient from './SettingsClient'
import type { Setting, AssetClass } from './types'

export default async function SettingsPage() {
  const supabase = createClient()

  const [{ data: settings }, { data: assetClasses }] = await Promise.all([
    supabase.from('settings').select('*').order('key'),
    supabase.from('asset_classes').select('*').order('code'),
  ])

  return (
    <SettingsClient
      initialSettings={(settings ?? []) as Setting[]}
      initialAssetClasses={(assetClasses ?? []) as AssetClass[]}
    />
  )
}
