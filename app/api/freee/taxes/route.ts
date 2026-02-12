import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { freeeFetchWithAutoRefresh } from '../_shared'

// freee: 税区分（tax_code）は deals.details.tax_code に使う。
// 環境/契約によって返却形式が揺れることがあるので、2経路で取得してフォールバックする。
const FREEE_TAXES_COMPANY_BASE = 'https://api.freee.co.jp/api/1/taxes/companies'
const FREEE_COMPANY_URL_BASE = 'https://api.freee.co.jp/api/1/companies'

type FreeeTax = {
  code: number
  name: string
  name_ja?: string
  display_category?: string
  available?: boolean
}

type FreeeTaxesResponse = {
  taxes?: FreeeTax[]
}

type FreeeCompanyDetailsResponse = {
  company?: {
    taxes?: FreeeTax[]
  }
}

export async function GET(request: NextRequest) {
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

  let taxes: FreeeTax[] = []
  let refreshed: Awaited<ReturnType<typeof freeeFetchWithAutoRefresh>>['refreshed'] = null
  let lastStatus = 0
  let source: 'taxes_endpoint' | 'company_details' | 'none' = 'none'

  // 1) まずは税区分一覧API
  {
    const url = `${FREEE_TAXES_COMPANY_BASE}/${encodeURIComponent(companyId)}`
    const res = await freeeFetchWithAutoRefresh({ url, accessToken, refreshToken })
    refreshed = res.refreshed ?? refreshed
    lastStatus = res.response.status
    if (res.response.ok) {
      const data = (await res.response.json()) as FreeeTaxesResponse
      taxes = data.taxes ?? []
      if (taxes.length > 0) source = 'taxes_endpoint'
    }
  }

  // 2) フォールバック: companies詳細から taxes を拾う
  if (taxes.length === 0) {
    const url = `${FREEE_COMPANY_URL_BASE}/${encodeURIComponent(companyId)}?details=true&taxes=true`
    const res = await freeeFetchWithAutoRefresh({ url, accessToken, refreshToken })
    refreshed = res.refreshed ?? refreshed
    lastStatus = res.response.status
    if (res.response.ok) {
      const data = (await res.response.json()) as FreeeCompanyDetailsResponse
      taxes = data.company?.taxes ?? []
      if (taxes.length > 0) source = 'company_details'
    }
  }

  // それでも0件なら、クライアント側で原因がわかるようメタ情報を返す
  const response = NextResponse.json({
    taxes,
    source,
    hint: taxes.length === 0 ? '税区分が0件です。freee側の事業所設定/権限/契約を確認してください。' : undefined,
    lastStatus: taxes.length === 0 ? lastStatus : undefined,
  })

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
