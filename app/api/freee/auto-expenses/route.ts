import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { freeeFetchWithAutoRefresh } from '../_shared'

const FREEE_ACCOUNT_ITEMS_URL = 'https://api.freee.co.jp/api/1/account_items'
const FREEE_TAXES_COMPANY_BASE = 'https://api.freee.co.jp/api/1/taxes/companies'
const FREEE_DEALS_URL = 'https://api.freee.co.jp/api/1/deals'

type Expense = {
  id?: string
  expense_date: string
  amount: number
  description: string
  receipt_url?: string | null
}

export async function POST(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const cookieStore = cookies()
  const accessToken = cookieStore.get('freee_access_token')?.value ?? ''
  const refreshToken = cookieStore.get('freee_refresh_token')?.value ?? ''
  const companyIdRaw = cookieStore.get('freee_company_id')?.value ?? ''
  const companyId = companyIdRaw && /^\d+$/.test(companyIdRaw) ? Number(companyIdRaw) : null

  if (!accessToken) return NextResponse.json({ ok: false, error: 'not_connected' }, { status: 401 })
  if (!companyId) return NextResponse.json({ ok: false, error: 'missing_company' }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as { expenses?: Expense[]; limit?: number }
  const expenses = Array.isArray(body.expenses)
    ? body.expenses
        .filter((expense) => {
          const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(String(expense.expense_date ?? ''))
          const amountOk = Number.isFinite(Number(expense.amount)) && Number(expense.amount) >= 1
          const descriptionOk = String(expense.description ?? '').trim().length >= 1
          return dateOk && amountOk && descriptionOk
        })
        .slice(0, Math.max(1, Number(body.limit ?? 100)))
    : []
  if (expenses.length === 0) {
    return NextResponse.json({ ok: false, error: 'missing_expenses' }, { status: 400 })
  }

  let activeAccessToken = accessToken

  const accountRes = await freeeFetchWithAutoRefresh({
    url: `${FREEE_ACCOUNT_ITEMS_URL}?company_id=${companyId}`,
    accessToken: activeAccessToken,
    refreshToken,
  })
  if (accountRes.refreshed?.access_token) activeAccessToken = accountRes.refreshed.access_token
  if (!accountRes.response.ok) {
    return NextResponse.json({ ok: false, error: `account_items_error:${accountRes.response.status}` }, { status: accountRes.response.status })
  }
  const accountJson = (await accountRes.response.json()) as { account_items?: Array<{ id: number; name: string }> }
  const preferred = ['雑費', '消耗品', '仕入', '通信費']
  const accountItem =
    (accountJson.account_items ?? []).find((a) => preferred.some((p) => String(a.name).includes(p))) ??
    (accountJson.account_items ?? [])[0]
  if (!accountItem?.id) {
    return NextResponse.json({ ok: false, error: 'missing_account_item' }, { status: 400 })
  }

  const taxRes = await freeeFetchWithAutoRefresh({
    url: `${FREEE_TAXES_COMPANY_BASE}/${companyId}`,
    accessToken: activeAccessToken,
    refreshToken,
  })
  if (taxRes.refreshed?.access_token) activeAccessToken = taxRes.refreshed.access_token
  if (!taxRes.response.ok) {
    return NextResponse.json({ ok: false, error: `taxes_error:${taxRes.response.status}` }, { status: taxRes.response.status })
  }
  const taxJson = (await taxRes.response.json()) as { taxes?: Array<{ code: number; name?: string; name_ja?: string }> }
  const tax =
    (taxJson.taxes ?? []).find((t) => String(t.name ?? '').includes('purchase_with_tax_10')) ??
    (taxJson.taxes ?? []).find((t) => String(t.name_ja ?? '').includes('課税仕入')) ??
    (taxJson.taxes ?? [])[0]
  if (!tax?.code) {
    return NextResponse.json({ ok: false, error: 'missing_tax_code' }, { status: 400 })
  }

  const results: Array<{ ok: boolean; expenseId?: string; status: number }> = []
  for (const exp of expenses) {
    const payload = {
      company_id: companyId,
      issue_date: exp.expense_date,
      type: 'expense',
      details: [
        {
          tax_code: tax.code,
          account_item_id: accountItem.id,
          amount: Math.max(0, Math.floor(exp.amount)),
          description: String(exp.description ?? '').trim().slice(0, 250),
        },
      ],
    }

    const dealRes = await freeeFetchWithAutoRefresh({
      url: FREEE_DEALS_URL,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      accessToken: activeAccessToken,
      refreshToken,
    })
    if (dealRes.refreshed?.access_token) activeAccessToken = dealRes.refreshed.access_token
    results.push({ ok: dealRes.response.ok, expenseId: exp.id, status: dealRes.response.status })
  }

  const success = results.filter((r) => r.ok).length
  const failed = results.length - success
  const response = NextResponse.json({
    ok: true,
    accountItem: accountItem.name,
    taxCode: tax.code,
    success,
    failed,
    results,
  })

  const latest = [accountRes.refreshed, taxRes.refreshed].find((x) => x?.access_token)
  if (latest?.access_token) {
    response.cookies.set('freee_access_token', latest.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: Math.max(60, Number(latest.expires_in || 0)),
      path: '/',
    })
    if (latest.refresh_token) {
      response.cookies.set('freee_refresh_token', latest.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 90,
        path: '/',
      })
    }
  }

  return response
}
