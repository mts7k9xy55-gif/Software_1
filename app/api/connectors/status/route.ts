import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { getConnectorStatuses, resolveProvider } from '@/lib/connectors/accounting/router'
import { getEnabledPacks } from '@/lib/core/packs'
import { getRegionDefinition } from '@/lib/core/regions'
import { resolveTenantContext } from '@/lib/core/tenant'

export async function GET(request: Request) {
  const authState = auth()
  if (!authState.userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const url = new URL(request.url)
  const region = getRegionDefinition(url.searchParams.get('region'))
  const tenant = resolveTenantContext({
    auth: authState,
    regionCode: region.code,
    mode: url.searchParams.get('mode'),
  })

  if (!tenant) return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })

  const routing = resolveProvider({
    regionCode: region.code,
    requestedProvider: url.searchParams.get('provider'),
  })

  const providerStatuses = getConnectorStatuses(cookies())
  const activeProviderStatus = providerStatuses.find((row) => row.provider === routing.provider)
  const freeeStatus = providerStatuses.find((row) => row.provider === 'freee')

  const status = {
    provider: routing.provider,
    provider_status: activeProviderStatus,
    providers: providerStatuses,
    freee: freeeStatus
      ? {
          configured: freeeStatus.configured,
          connected: freeeStatus.connected,
          companyId: freeeStatus.account_context ? Number(freeeStatus.account_context) : null,
          nextAction: freeeStatus.next_action,
          mode: freeeStatus.mode,
        }
      : {
          configured: false,
          connected: false,
          companyId: null,
          nextAction: 'open_oauth',
          mode: 'oauth_per_user',
        },
    ocr: {
      enabled: (process.env.ENABLE_RECEIPT_OCR ?? '0') === '1',
      provider: process.env.GEMINI_API_KEY ? 'gemini' : 'none',
    },
    llm: {
      externalEnabled: (process.env.ENABLE_EXTERNAL_LLM ?? '0') === '1',
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite',
    },
    packs: getEnabledPacks().map((pack) => ({ key: pack.key, title: pack.title })),
    tenant,
    support_boundary: {
      owner_scope: 'connectivity_and_classification_pipeline',
      provider_scope: 'accounting_rules_and_provider_internal_processing',
    },
    region: {
      code: region.code,
      name: region.name,
      countryCode: region.countryCode,
      uxLabel: region.uxLabel,
      platforms: region.platforms,
    },
  }

  return NextResponse.json({ ok: true, diagnostic_code: 'CONNECTORS_STATUS_OK', status })
}
