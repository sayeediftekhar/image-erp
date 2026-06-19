import { createClient } from '@/lib/supabase/server'
import AssetsClient from './AssetsClient'
import type { FixedAsset, Entity, AssetClassOption } from './types'

export default async function AssetsPage() {
  const supabase = createClient()

  const [
    { data: assets },
    { data: entities },
    { data: assetClasses },
    { data: thresholdRow },
  ] = await Promise.all([
    supabase.from('fixed_assets').select('*').order('name'),
    supabase.from('entities').select('id, code, name').order('code'),
    supabase.from('asset_classes').select('code, name').eq('active', true).order('code'),
    supabase.from('settings').select('value').eq('key', 'capitalisation_threshold').single(),
  ])

  return (
    <AssetsClient
      initialAssets={(assets ?? []) as FixedAsset[]}
      entities={(entities ?? []) as Entity[]}
      assetClasses={(assetClasses ?? []) as AssetClassOption[]}
      capitalisationThreshold={thresholdRow?.value ?? null}
    />
  )
}
