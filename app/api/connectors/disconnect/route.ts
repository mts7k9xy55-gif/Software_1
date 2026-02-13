import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { resolveProvider } from '@/lib/connectors/accounting/router'

function getOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host) return `${proto}://${host}`
  return new URL(request.url).origin
}

export async function POST(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    provider?: string
    region?: string
    return_to?: string
  }

  const routing = resolveProvider({
    regionCode: body.region,
    requestedProvider: body.provider,
  })

  if (routing.provider === 'freee') {
    const destination = new URL('/api/freee/disconnect', getOrigin(request))
    return NextResponse.json({
      ok: true,
      diagnostic_code: 'FREEE_DISCONNECT_REDIRECT',
      redirect_to: destination.toString(),
      next_action: 'Open redirect_to in browser to finish freee disconnect.',
      contact: routing.definition.support.url,
    })
  }

  const response = NextResponse.json({
    ok: true,
    provider: routing.provider,
    diagnostic_code: 'CONNECTOR_DISCONNECTED',
    next_action: 'Reconnect provider if needed.',
    contact: routing.definition.support.url,
    return_to: body.return_to || '/',
  })

  if (routing.provider === 'quickbooks') {
    response.cookies.delete('qbo_access_token')
    response.cookies.delete('qbo_refresh_token')
    response.cookies.delete('qbo_realm_id')
  }

  if (routing.provider === 'xero') {
    response.cookies.delete('xero_access_token')
    response.cookies.delete('xero_refresh_token')
    response.cookies.delete('xero_tenant_id')
  }

  return response
}
