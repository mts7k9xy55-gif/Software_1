import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { freeeFetchWithAutoRefresh } from '../_shared'

const FREEE_DEALS_URL = 'https://api.freee.co.jp/api/1/deals'

type DealDetail = {
  tax_code: number
  account_item_id: number
  amount: number
  description?: string
}

type DealCreateBody = {
  company_id: number
  issue_date: string
  type: 'expense'
  details: DealDetail[]
}

type DealCreateResult = {
  ok: boolean
  expenseId?: string
  requestId?: string | null
  status: number
  request?: unknown
  body?: unknown
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies()
  const accessToken = cookieStore.get('freee_access_token')?.value ?? ''
  const refreshToken = cookieStore.get('freee_refresh_token')?.value ?? ''
  const companyIdRaw = cookieStore.get('freee_company_id')?.value ?? ''
  const companyIdFromCookie = companyIdRaw && /^\d+$/.test(companyIdRaw) ? Number(companyIdRaw) : null

  if (!accessToken) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    // ignore
  }

  const body = payload as
    | {
        companyId?: number
        accountItemId?: number
        taxCode?: number
        dryRun?: boolean
        expenses?: Array<{
          id?: string
          expense_date: string
          amount: number
          description: string
          receipt_url?: string | null
        }>
      }
    | null

  const companyId = Number(body?.companyId ?? companyIdFromCookie ?? 0)
  const accountItemId = Number(body?.accountItemId ?? 0)
  const taxCode = Number(body?.taxCode ?? 0)
  const dryRun = Boolean(body?.dryRun)
  const expenses = Array.isArray(body?.expenses) ? body!.expenses : []

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'missing_company' }, { status: 400 })
  }
  if (!Number.isFinite(accountItemId) || accountItemId <= 0) {
    return NextResponse.json({ error: 'missing_account_item' }, { status: 400 })
  }
  if (!Number.isFinite(taxCode) || taxCode <= 0) {
    return NextResponse.json({ error: 'missing_tax_code' }, { status: 400 })
  }
  if (expenses.length === 0) {
    return NextResponse.json({ error: 'missing_expenses' }, { status: 400 })
  }

  const buildDeal = (exp: (typeof expenses)[number]): DealCreateBody => {
    // freee の deals 作成はバリデーションが厳しめなので、まずは最小ペイロードで通す。
    // 余計なフィールド（due_date / ref_number / URL 付き説明など）は後で段階的に追加する。
    const desc = String(exp.description ?? '').trim().slice(0, 250)
    const amount = Math.max(0, Math.floor(exp.amount))
    return {
      company_id: companyId,
      issue_date: exp.expense_date,
      type: 'expense',
      details: [
        {
          tax_code: taxCode,
          account_item_id: accountItemId,
          amount,
          description: desc,
        },
      ],
    }
  }

  const deals = expenses.map(buildDeal)
  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, deals })
  }

  const results: DealCreateResult[] = []
  let refreshedAccessToken: string | null = null
  let refreshedTokenPayload: unknown = null

  for (const [index, deal] of deals.entries()) {
    const { response: resp, refreshed } = await freeeFetchWithAutoRefresh({
      url: FREEE_DEALS_URL,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deal),
      },
      accessToken: refreshedAccessToken ?? accessToken,
      refreshToken,
    })

    if (refreshed?.access_token) {
      refreshedAccessToken = refreshed.access_token
      refreshedTokenPayload = refreshed
    }

    let respBody: unknown = null
    try {
      respBody = await resp.json()
    } catch {
      // ignore
    }

    const requestId =
      resp.headers.get('x-freee-request-id') ??
      resp.headers.get('x-freee-request-id'.toUpperCase()) ??
      resp.headers.get('X-Freee-Request-Id') ??
      resp.headers.get('X-Freee-Request-ID')

    results.push({
      ok: resp.ok,
      expenseId: expenses[index]?.id,
      requestId,
      status: resp.status,
      request: deal,
      body: respBody,
    })
  }

  const response = NextResponse.json({ ok: true, results })
  if (refreshedTokenPayload && typeof refreshedTokenPayload === 'object') {
    const refreshed = refreshedTokenPayload as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (refreshed.access_token) {
      const expiresIn = Number(refreshed.expires_in || 0)
      response.cookies.set('freee_access_token', refreshed.access_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: Math.max(60, expiresIn),
        path: '/',
      })
    }
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
