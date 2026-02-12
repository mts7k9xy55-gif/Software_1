import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { freeeFetchWithAutoRefresh, type FreeeTokenResponse } from '../_shared'

const FREEE_COMPANIES_URL = 'https://api.freee.co.jp/api/1/companies'

type FreeeCompany = {
  id: number
  name?: string
  name_kana?: string
  display_name?: string
  company_number?: string
  role?: string
}

type FreeeCompaniesResponse = {
  companies?: FreeeCompany[]
}

async function fetchCompaniesWithRefresh() {
  const cookieStore = cookies()
  const accessToken = cookieStore.get('freee_access_token')?.value ?? ''
  const refreshToken = cookieStore.get('freee_refresh_token')?.value ?? ''

  if (!accessToken) {
    return { status: 401 as const, json: { error: 'not_connected' as const } }
  }

  const { response: resp, refreshed } = await freeeFetchWithAutoRefresh({
    url: FREEE_COMPANIES_URL,
    accessToken,
    refreshToken,
  })

  if (!resp.ok) {
    return {
      status: resp.status as 400 | 401 | 403 | 500,
      json: { error: 'freee_error' as const, status: resp.status },
      refreshed,
    }
  }

  const data = (await resp.json()) as FreeeCompaniesResponse
  return { status: 200 as const, json: { companies: data.companies ?? [] }, refreshed }
}

export async function GET() {
  const cookieStore = cookies()
  const selectedCompanyIdRaw = cookieStore.get('freee_company_id')?.value ?? ''
  const selectedCompanyId = selectedCompanyIdRaw ? Number(selectedCompanyIdRaw) : null

  const result = await fetchCompaniesWithRefresh()
  const response = NextResponse.json({
    selectedCompanyId: Number.isFinite(selectedCompanyId) ? selectedCompanyId : null,
    ...result.json,
  })

  if (result.refreshed?.access_token) {
    const expiresIn = Number(result.refreshed.expires_in || 0)
    response.cookies.set('freee_access_token', result.refreshed.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: Math.max(60, expiresIn),
      path: '/',
    })
    if (result.refreshed.refresh_token) {
      response.cookies.set('freee_refresh_token', result.refreshed.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 90,
        path: '/',
      })
    }
  }

  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const accessToken = cookieStore.get('freee_access_token')?.value ?? ''

  if (!accessToken) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 })
  }

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    // ignore
  }

  const companyId = (body as { companyId?: unknown } | null)?.companyId
  const companyIdStr = typeof companyId === 'number' ? String(companyId) : typeof companyId === 'string' ? companyId : ''

  if (!/^\d+$/.test(companyIdStr)) {
    return NextResponse.json({ error: 'invalid_company_id' }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true, companyId: Number(companyIdStr) })
  response.cookies.set('freee_company_id', companyIdStr, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 90,
    path: '/',
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
