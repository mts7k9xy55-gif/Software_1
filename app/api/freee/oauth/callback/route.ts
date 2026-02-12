import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const FREEE_TOKEN_URL = 'https://accounts.secure.freee.co.jp/public_api/token'
const FREEE_COMPANIES_URL = 'https://api.freee.co.jp/api/1/companies'

type FreeeTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  scope: string
}

type FreeeCompaniesResponse = {
  companies?: Array<{ id: number }>
}

function getOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host) return `${proto}://${host}`
  return new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_FREEE_CLIENT_ID
  const clientSecret = process.env.FREEE_CLIENT_SECRET
  const redirectUri = process.env.NEXT_PUBLIC_FREEE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(new URL('/?freee=missing_env', getOrigin(request)))
  }

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  // `prompt=select_company` を使うと、freee側が `company_id` を返すことがある。
  const companyIdFromRedirect = request.nextUrl.searchParams.get('company_id')
  const savedState = cookies().get('freee_oauth_state')?.value

  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL('/?freee=invalid_state', getOrigin(request)))
  }

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })

  const tokenResponse = await fetch(FREEE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenParams.toString(),
    cache: 'no-store',
  })

  if (!tokenResponse.ok) {
    return NextResponse.redirect(new URL('/?freee=token_error', getOrigin(request)))
  }

  const tokenData = (await tokenResponse.json()) as FreeeTokenResponse
  const accessToken = tokenData.access_token
  const refreshToken = tokenData.refresh_token
  const expiresIn = Number(tokenData.expires_in || 0)

  let companyId = ''
  if (companyIdFromRedirect && /^\d+$/.test(companyIdFromRedirect)) {
    companyId = companyIdFromRedirect
  }

  const companiesResponse = await fetch(FREEE_COMPANIES_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })

  if (!companyId && companiesResponse.ok) {
    const companiesData = (await companiesResponse.json()) as FreeeCompaniesResponse
    const firstCompany = companiesData.companies?.[0]
    if (firstCompany?.id) {
      companyId = String(firstCompany.id)
    }
  }

  const response = NextResponse.redirect(new URL('/?freee=connected', getOrigin(request)))
  response.cookies.delete('freee_oauth_state')
  response.cookies.set('freee_access_token', accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: Math.max(60, expiresIn),
    path: '/',
  })
  response.cookies.set('freee_refresh_token', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 90,
    path: '/',
  })

  if (companyId) {
    response.cookies.set('freee_company_id', companyId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 90,
      path: '/',
    })
  }

  return response
}
