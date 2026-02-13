import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import {
  applyRefreshedFreeeCookies,
} from '@/lib/connectors/freee'
import { fetchReviewQueueByProvider, resolveProvider } from '@/lib/connectors/accounting/router'
import { resolveTenantContext } from '@/lib/core/tenant'

export async function GET(request: NextRequest) {
  const authState = auth()
  if (!authState.userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const limit = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get('limit') ?? 30)))
  const tenant = resolveTenantContext({
    auth: authState,
    regionCode: request.nextUrl.searchParams.get('region'),
    mode: request.nextUrl.searchParams.get('mode'),
  })
  if (!tenant) return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })

  const routing = resolveProvider({
    regionCode: request.nextUrl.searchParams.get('region') ?? tenant.region_code,
    requestedProvider: request.nextUrl.searchParams.get('provider'),
  })

  const fetched = await fetchReviewQueueByProvider({
    cookieStore: cookies(),
    provider: routing.provider,
    limit,
  })

  if (!fetched.ok) {
    const response = NextResponse.json(
      {
        ok: false,
        provider: routing.provider,
        diagnostic_code: fetched.diagnostic_code,
        status: fetched.status,
        next_action: 'Reconnect provider or check account configuration.',
        contact: routing.definition.support.url,
      },
      { status: fetched.status }
    )
    if (routing.provider === 'freee') applyRefreshedFreeeCookies(response, fetched.freeeRefresh)
    return response
  }

  const response = NextResponse.json({
    ok: true,
    provider: routing.provider,
    diagnostic_code: fetched.diagnostic_code,
    queue: fetched.queue,
    next_action: 'Review queued drafts in provider.',
    contact: routing.definition.support.url,
  })
  if (routing.provider === 'freee') applyRefreshedFreeeCookies(response, fetched.freeeRefresh)
  return response
}
