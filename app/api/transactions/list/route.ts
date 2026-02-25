import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { listTransactions } from '@/lib/db/transactions'
import { resolveTenantContext } from '@/lib/core/tenant'

function toDateStr(v: unknown): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v ?? '').slice(0, 10)
}

export async function GET(request: NextRequest) {
  try {
    const authState = auth()
    if (!authState.userId) {
      return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const region = searchParams.get('region') ?? 'JP'
    const mode = searchParams.get('mode')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 500)
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0)

    const tenant = resolveTenantContext({
      auth: authState,
      regionCode: region,
      mode,
    })
    if (!tenant) {
      return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })
    }

    let records: Awaited<ReturnType<typeof listTransactions>>
    try {
      records = await listTransactions(tenant, { limit, offset })
    } catch (dbErr) {
      console.warn('[transactions/list] DB unavailable:', dbErr)
      return NextResponse.json({ ok: true, records: [] })
    }

    const normalized = records.map((r) => ({
      transaction: {
        ...r.transaction,
        occurred_at: toDateStr(r.transaction.occurred_at),
      },
      decision: {
        ...r.decision,
        date: toDateStr(r.decision.date),
      },
      posted: r.posted,
    }))

    return NextResponse.json({ ok: true, records: normalized })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'TRANSACTIONS_LIST_FAILED',
        message: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 }
    )
  }
}
