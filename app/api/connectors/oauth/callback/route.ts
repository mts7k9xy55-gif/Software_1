import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { getProviderDefinition } from '@/lib/connectors/accounting/catalog'
import { resolveProvider } from '@/lib/connectors/accounting/router'

const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'

function getOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host) return `${proto}://${host}`
  return new URL(request.url).origin
}

function readReturnTo(): string {
  return cookies().get('connector_oauth_return_to')?.value || '/'
}

function oauthRedirect(request: NextRequest, pathWithQuery: string): NextResponse {
  return NextResponse.redirect(new URL(pathWithQuery, getOrigin(request)))
}

function setConnectorCookies(response: NextResponse, args: {
  provider: 'quickbooks' | 'xero'
  accessToken: string
  refreshToken: string
  accountContext: string
  expiresIn: number
}) {
  if (args.provider === 'quickbooks') {
    response.cookies.set('qbo_access_token', args.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: Math.max(60, args.expiresIn),
      path: '/',
    })
    response.cookies.set('qbo_refresh_token', args.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 90,
      path: '/',
    })
    response.cookies.set('qbo_realm_id', args.accountContext, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 90,
      path: '/',
    })
  }

  if (args.provider === 'xero') {
    response.cookies.set('xero_access_token', args.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: Math.max(60, args.expiresIn),
      path: '/',
    })
    response.cookies.set('xero_refresh_token', args.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 90,
      path: '/',
    })
    response.cookies.set('xero_tenant_id', args.accountContext, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 90,
      path: '/',
    })
  }

  response.cookies.delete('connector_oauth_return_to')
  response.cookies.delete('connector_oauth_state_quickbooks')
  response.cookies.delete('connector_oauth_state_xero')
}

export async function GET(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const requestedProvider = request.nextUrl.searchParams.get('provider')
  const region = request.nextUrl.searchParams.get('region')
  const inferredProvider =
    requestedProvider ||
    (request.nextUrl.searchParams.get('realmId') ? 'quickbooks' : null) ||
    (cookies().get('connector_oauth_state_xero')?.value ? 'xero' : null)
  const routing = resolveProvider({ regionCode: region, requestedProvider: inferredProvider })

  if (routing.provider === 'freee') {
    const params = request.nextUrl.searchParams.toString()
    const path = `/api/freee/oauth/callback${params ? `?${params}` : ''}`
    return oauthRedirect(request, path)
  }

  if (routing.provider === 'quickbooks') {
    const state = request.nextUrl.searchParams.get('state') ?? ''
    const code = request.nextUrl.searchParams.get('code') ?? ''
    const realmId = request.nextUrl.searchParams.get('realmId') ?? ''
    const savedState = cookies().get('connector_oauth_state_quickbooks')?.value ?? ''

    if (!state || !code || !realmId || !savedState || state !== savedState) {
      return oauthRedirect(request, `${readReturnTo()}?provider=quickbooks&oauth=invalid_state`)
    }

    const clientId = process.env.QBO_CLIENT_ID
    const clientSecret = process.env.QBO_CLIENT_SECRET
    const redirectUri = process.env.QBO_REDIRECT_URI

    if (!clientId || !clientSecret || !redirectUri) {
      return oauthRedirect(request, `${readReturnTo()}?provider=quickbooks&oauth=missing_env`)
    }

    const tokenResponse = await fetch(QBO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
      cache: 'no-store',
    })

    if (!tokenResponse.ok) {
      return oauthRedirect(request, `${readReturnTo()}?provider=quickbooks&oauth=token_error`)
    }

    const tokenPayload = (await tokenResponse.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    const accessToken = tokenPayload.access_token ?? ''
    const refreshToken = tokenPayload.refresh_token ?? ''
    const expiresIn = Number(tokenPayload.expires_in ?? 3600)

    if (!accessToken || !refreshToken) {
      return oauthRedirect(request, `${readReturnTo()}?provider=quickbooks&oauth=token_error`)
    }

    const response = oauthRedirect(request, `${readReturnTo()}?provider=quickbooks&oauth=connected`)
    setConnectorCookies(response, {
      provider: 'quickbooks',
      accessToken,
      refreshToken,
      accountContext: realmId,
      expiresIn,
    })
    return response
  }

  if (routing.provider === 'xero') {
    const state = request.nextUrl.searchParams.get('state') ?? ''
    const code = request.nextUrl.searchParams.get('code') ?? ''
    const savedState = cookies().get('connector_oauth_state_xero')?.value ?? ''

    if (!state || !code || !savedState || state !== savedState) {
      return oauthRedirect(request, `${readReturnTo()}?provider=xero&oauth=invalid_state`)
    }

    const clientId = process.env.XERO_CLIENT_ID
    const clientSecret = process.env.XERO_CLIENT_SECRET
    const redirectUri = process.env.XERO_REDIRECT_URI

    if (!clientId || !clientSecret || !redirectUri) {
      return oauthRedirect(request, `${readReturnTo()}?provider=xero&oauth=missing_env`)
    }

    const tokenResponse = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
      cache: 'no-store',
    })

    if (!tokenResponse.ok) {
      return oauthRedirect(request, `${readReturnTo()}?provider=xero&oauth=token_error`)
    }

    const tokenPayload = (await tokenResponse.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    const accessToken = tokenPayload.access_token ?? ''
    const refreshToken = tokenPayload.refresh_token ?? ''
    const expiresIn = Number(tokenPayload.expires_in ?? 3600)

    if (!accessToken || !refreshToken) {
      return oauthRedirect(request, `${readReturnTo()}?provider=xero&oauth=token_error`)
    }

    const connectionsResponse = await fetch(XERO_CONNECTIONS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    })

    if (!connectionsResponse.ok) {
      return oauthRedirect(request, `${readReturnTo()}?provider=xero&oauth=tenant_error`)
    }

    const connections = (await connectionsResponse.json()) as Array<{ tenantId?: string }>
    const tenantId = String(connections[0]?.tenantId ?? '')
    if (!tenantId) {
      return oauthRedirect(request, `${readReturnTo()}?provider=xero&oauth=tenant_missing`)
    }

    const response = oauthRedirect(request, `${readReturnTo()}?provider=xero&oauth=connected`)
    setConnectorCookies(response, {
      provider: 'xero',
      accessToken,
      refreshToken,
      accountContext: tenantId,
      expiresIn,
    })
    return response
  }

  const definition = getProviderDefinition(routing.provider)
  return NextResponse.json(
    {
      ok: false,
      diagnostic_code: 'PROVIDER_NOT_SUPPORTED',
      next_action: 'Select a supported provider.',
      contact: definition.support.url,
    },
    { status: 400 }
  )
}
