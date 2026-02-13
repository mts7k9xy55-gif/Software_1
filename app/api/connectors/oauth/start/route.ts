import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { resolveProvider } from '@/lib/connectors/accounting/router'

const QUICKBOOKS_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize'

function getOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host) return `${proto}://${host}`
  return new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const region = request.nextUrl.searchParams.get('region')
  const requestedProvider = request.nextUrl.searchParams.get('provider')
  const returnToRaw = request.nextUrl.searchParams.get('return_to') || '/'
  const returnTo = returnToRaw.startsWith('/') ? returnToRaw : '/'

  const routing = resolveProvider({ regionCode: region, requestedProvider })

  if (routing.provider === 'freee') {
    const destination = new URL('/api/freee/oauth/start', getOrigin(request))
    return NextResponse.redirect(destination)
  }

  if (routing.provider === 'quickbooks') {
    const clientId = process.env.QBO_CLIENT_ID
    const redirectUri = process.env.QBO_REDIRECT_URI

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        {
          ok: false,
          provider: 'quickbooks',
          diagnostic_code: 'QBO_ENV_MISSING',
          next_action: 'Set QBO_CLIENT_ID and QBO_REDIRECT_URI.',
          contact: routing.definition.support.url,
        },
        { status: 500 }
      )
    }

    const state = crypto.randomUUID()
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      state,
    })

    const response = NextResponse.redirect(`${QUICKBOOKS_AUTH_URL}?${params.toString()}`)
    response.cookies.set('connector_oauth_state_quickbooks', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 10 * 60,
      path: '/',
    })
    response.cookies.set('connector_oauth_return_to', returnTo, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 10 * 60,
      path: '/',
    })
    return response
  }

  if (routing.provider === 'xero') {
    const clientId = process.env.XERO_CLIENT_ID
    const redirectUri = process.env.XERO_REDIRECT_URI

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        {
          ok: false,
          provider: 'xero',
          diagnostic_code: 'XERO_ENV_MISSING',
          next_action: 'Set XERO_CLIENT_ID and XERO_REDIRECT_URI.',
          contact: routing.definition.support.url,
        },
        { status: 500 }
      )
    }

    const state = crypto.randomUUID()
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'offline_access accounting.transactions accounting.contacts',
      state,
    })

    const response = NextResponse.redirect(`${XERO_AUTH_URL}?${params.toString()}`)
    response.cookies.set('connector_oauth_state_xero', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 10 * 60,
      path: '/',
    })
    response.cookies.set('connector_oauth_return_to', returnTo, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 10 * 60,
      path: '/',
    })
    return response
  }

  return NextResponse.json(
    {
      ok: false,
      diagnostic_code: 'PROVIDER_NOT_SUPPORTED',
      next_action: 'Select a supported accounting provider.',
      contact: routing.definition.support.url,
    },
    { status: 400 }
  )
}
