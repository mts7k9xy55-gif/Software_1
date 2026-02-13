import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import {
  applyRefreshedFreeeCookies,
  listFreeeExpenseDrafts,
  readFreeeSession,
} from '@/lib/connectors/freee'

function summarizeReview(deal: Record<string, unknown>) {
  const id = Number(deal.id ?? 0)
  const issueDate = String(deal.issue_date ?? '')
  const amount = Number(deal.amount ?? 0)
  const status = String(deal.status ?? deal.type ?? 'unknown')
  const memo = String(deal.description ?? deal.ref_number ?? '').slice(0, 120)

  return {
    id: Number.isFinite(id) ? id : null,
    issue_date: issueDate,
    amount: Number.isFinite(amount) ? amount : 0,
    status,
    memo,
  }
}

export async function GET(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const session = readFreeeSession(cookies())
  if (!session.accessToken || !session.companyId) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'FREEE_NOT_CONNECTED',
        message: 'freee未接続のためレビューキューを取得できません。',
      },
      { status: 401 }
    )
  }

  const limit = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get('limit') ?? 30)))
  const fetched = await listFreeeExpenseDrafts({ session, limit })

  if (!fetched.ok) {
    const response = NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'FREEE_QUEUE_FETCH_FAILED',
        status: fetched.status,
      },
      { status: fetched.status }
    )
    applyRefreshedFreeeCookies(response, fetched.refreshed)
    return response
  }

  const queue = fetched.deals.map(summarizeReview)
  const response = NextResponse.json({
    ok: true,
    diagnostic_code: 'FREEE_QUEUE_FETCHED',
    queue,
  })
  applyRefreshedFreeeCookies(response, fetched.refreshed)
  return response
}
