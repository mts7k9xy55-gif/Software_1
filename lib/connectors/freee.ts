import type { NextResponse } from 'next/server'
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

export const FREEE_TOKEN_URL = 'https://accounts.secure.freee.co.jp/public_api/token'
const FREEE_DEALS_URL = 'https://api.freee.co.jp/api/1/deals'
const FREEE_ACCOUNT_ITEMS_URL = 'https://api.freee.co.jp/api/1/account_items'
const FREEE_TAXES_COMPANY_BASE = 'https://api.freee.co.jp/api/1/taxes/companies'

export type FreeeTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
}

export interface FreeeSession {
  accessToken: string
  refreshToken: string
  companyId: number | null
}

export type FreeeAccountItem = {
  id: number
  name: string
  default_tax_code?: number | null
}

export type FreeeTax = {
  code: number
  name?: string
  name_ja?: string
}

export function readFreeeSession(cookieStore: ReadonlyRequestCookies): FreeeSession {
  const accessToken = cookieStore.get('freee_access_token')?.value ?? ''
  const refreshToken = cookieStore.get('freee_refresh_token')?.value ?? ''
  const companyRaw = cookieStore.get('freee_company_id')?.value ?? ''
  const companyId = companyRaw && /^\d+$/.test(companyRaw) ? Number(companyRaw) : null
  return { accessToken, refreshToken, companyId }
}

export function applyRefreshedFreeeCookies(
  response: NextResponse,
  refreshed: FreeeTokenResponse | null
): void {
  if (!refreshed?.access_token) return

  response.cookies.set('freee_access_token', refreshed.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: Math.max(60, Number(refreshed.expires_in || 0)),
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

export async function refreshFreeeAccessToken(refreshToken: string): Promise<FreeeTokenResponse | null> {
  const clientId = process.env.NEXT_PUBLIC_FREEE_CLIENT_ID
  const clientSecret = process.env.FREEE_CLIENT_SECRET

  if (!clientId || !clientSecret) return null

  const tokenParams = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  })

  const response = await fetch(FREEE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
    cache: 'no-store',
  })

  if (!response.ok) return null
  return (await response.json()) as FreeeTokenResponse
}

export async function freeeFetchWithAutoRefresh(args: {
  url: string
  init?: RequestInit
  accessToken: string
  refreshToken: string
}): Promise<{ response: Response; refreshed: FreeeTokenResponse | null }> {
  const doFetch = async (token: string) =>
    fetch(args.url, {
      ...args.init,
      headers: {
        ...(args.init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    })

  let response = await doFetch(args.accessToken)
  let refreshed: FreeeTokenResponse | null = null

  if (response.status === 401 && args.refreshToken) {
    refreshed = await refreshFreeeAccessToken(args.refreshToken)
    if (refreshed?.access_token) {
      response = await doFetch(refreshed.access_token)
    }
  }

  return { response, refreshed }
}

export async function fetchFreeeAccountItems(session: FreeeSession): Promise<{
  accountItems: FreeeAccountItem[]
  refreshed: FreeeTokenResponse | null
  status: number
}> {
  const { response, refreshed } = await freeeFetchWithAutoRefresh({
    url: `${FREEE_ACCOUNT_ITEMS_URL}?company_id=${session.companyId}`,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  })

  if (!response.ok) return { accountItems: [], refreshed, status: response.status }

  const payload = (await response.json()) as { account_items?: FreeeAccountItem[] }
  return {
    accountItems: Array.isArray(payload.account_items) ? payload.account_items : [],
    refreshed,
    status: 200,
  }
}

export async function fetchFreeeTaxes(session: FreeeSession): Promise<{
  taxes: FreeeTax[]
  refreshed: FreeeTokenResponse | null
  status: number
}> {
  const { response, refreshed } = await freeeFetchWithAutoRefresh({
    url: `${FREEE_TAXES_COMPANY_BASE}/${session.companyId}`,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  })

  if (!response.ok) return { taxes: [], refreshed, status: response.status }

  const payload = (await response.json()) as { taxes?: FreeeTax[] }
  return {
    taxes: Array.isArray(payload.taxes) ? payload.taxes : [],
    refreshed,
    status: 200,
  }
}

export async function postFreeeDraftExpense(args: {
  session: FreeeSession
  issueDate: string
  accountItemId: number
  taxCode: number
  amount: number
  description: string
}): Promise<{
  ok: boolean
  status: number
  body: unknown
  refreshed: FreeeTokenResponse | null
  requestId: string | null
}> {
  const payload = {
    company_id: args.session.companyId,
    issue_date: args.issueDate,
    type: 'expense',
    details: [
      {
        account_item_id: args.accountItemId,
        tax_code: args.taxCode,
        amount: Math.max(1, Math.floor(args.amount)),
        description: String(args.description).slice(0, 250),
      },
    ],
  }

  const { response, refreshed } = await freeeFetchWithAutoRefresh({
    url: FREEE_DEALS_URL,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    accessToken: args.session.accessToken,
    refreshToken: args.session.refreshToken,
  })

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  const requestId =
    response.headers.get('x-freee-request-id') ??
    response.headers.get('X-Freee-Request-Id') ??
    response.headers.get('X-Freee-Request-ID')

  return {
    ok: response.ok,
    status: response.status,
    body,
    refreshed,
    requestId,
  }
}

export async function listFreeeExpenseDrafts(args: {
  session: FreeeSession
  limit?: number
}): Promise<{
  ok: boolean
  status: number
  deals: Array<Record<string, unknown>>
  refreshed: FreeeTokenResponse | null
}> {
  const limit = Math.max(1, Math.min(100, Number(args.limit ?? 30)))
  const query = new URLSearchParams({
    company_id: String(args.session.companyId ?? ''),
    type: 'expense',
    limit: String(limit),
  })

  const { response, refreshed } = await freeeFetchWithAutoRefresh({
    url: `${FREEE_DEALS_URL}?${query.toString()}`,
    accessToken: args.session.accessToken,
    refreshToken: args.session.refreshToken,
  })

  if (!response.ok) return { ok: false, status: response.status, deals: [], refreshed }

  const payload = (await response.json()) as { deals?: Array<Record<string, unknown>> }
  return {
    ok: true,
    status: 200,
    deals: Array.isArray(payload.deals) ? payload.deals : [],
    refreshed,
  }
}
