import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { listProvidersByRegion, resolveProviderByRegion } from '@/lib/connectors/accounting/catalog'
import { getRegionDefinition } from '@/lib/core/regions'

export async function GET(request: Request) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const url = new URL(request.url)
  const region = getRegionDefinition(url.searchParams.get('region'))
  const provider = resolveProviderByRegion(region.code)
  const providers = listProvidersByRegion(region.code)

  return NextResponse.json({
    ok: true,
    diagnostic_code: 'CONNECTOR_CATALOG_OK',
    region: {
      code: region.code,
      name: region.name,
      countryCode: region.countryCode,
      currency: region.currency,
    },
    active_provider: provider,
    providers: providers.map((row) => ({
      key: row.key,
      label: row.label,
      docs_url: row.docsUrl,
      support: row.support,
    })),
  })
}
