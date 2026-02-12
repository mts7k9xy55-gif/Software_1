import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { freeeFetchWithAutoRefresh } from '../_shared'

const FREEE_ACCOUNT_ITEMS_URL = 'https://api.freee.co.jp/api/1/account_items'

type FreeeAccountItem = {
  id: number
  name: string
  default_tax_code?: number | null
}

type FreeeAccountItemsResponse = {
  account_items?: FreeeAccountItem[]
}

export async function GET() {
  const cookieStore = cookies()
  const accessToken = cookieStore.get('freee_access_token')?.value ?? ''
  const refreshToken = cookieStore.get('freee_refresh_token')?.value ?? ''
  const companyIdRaw = cookieStore.get('freee_company_id')?.value ?? ''
  const companyId = companyIdRaw && /^\d+$/.test(companyIdRaw) ? companyIdRaw : ''

  if (!accessToken) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 })
  }
  if (!companyId) {
    return NextResponse.json({ error: 'missing_company' }, { status: 400 })
  }

  const url = `${FREEE_ACCOUNT_ITEMS_URL}?company_id=${encodeURIComponent(companyId)}`
  const { response: resp, refreshed } = await freeeFetchWithAutoRefresh({
    url,
    accessToken,
    refreshToken,
  })

  if (!resp.ok) {
    return NextResponse.json({ error: 'freee_error', status: resp.status }, { status: resp.status })
  }

  const data = (await resp.json()) as FreeeAccountItemsResponse
  const response = NextResponse.json({ accountItems: data.account_items ?? [] })

  if (refreshed?.access_token) {
    const expiresIn = Number(refreshed.expires_in || 0)
    response.cookies.set('freee_access_token', refreshed.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: Math.max(60, expiresIn),
      path: '/',
    })
    if (refreshed.refresh_token) {
      response.cookies.set('freee_refresh_token', refreshed.refresh_token, {
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
