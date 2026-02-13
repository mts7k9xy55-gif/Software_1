import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { applyRefreshedFreeeCookies } from '@/lib/connectors/freee'
import { fetchReviewQueueByProvider, postDraftsByProvider } from '@/lib/connectors/accounting/router'
import { createAuditMeta, emitAuditMeta } from '@/lib/core/audit'
import { resolveTenantContext } from '@/lib/core/tenant'
import type { PostingCommand } from '@/lib/core/types'

export async function POST(request: NextRequest) {
  const authState = auth()
  if (!authState.userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    commands?: PostingCommand[]
    mode?: string
    region?: string
  }

  const tenant = resolveTenantContext({
    auth: authState,
    regionCode: body.region ?? 'JP',
    mode: body.mode,
  })
  if (!tenant) return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })

  const commands = Array.isArray(body.commands) ? body.commands : []

  const posted = await postDraftsByProvider({
    cookieStore: cookies(),
    provider: 'freee',
    commands,
    tenant,
  })

  emitAuditMeta(
    createAuditMeta({
      actor_user_id: tenant.user_id,
      organization_id: tenant.organization_id,
      provider: 'freee',
      event_type: 'posting_freee_draft',
      status: posted.failed === 0 ? 'success' : 'error',
      diagnostic_code: posted.diagnostic_code,
      model_version: commands[0]?.decision?.model_version,
      rule_version: commands[0]?.decision?.rule_version,
    })
  )

  const response = NextResponse.json(
    {
      ok: posted.ok,
      diagnostic_code: posted.diagnostic_code,
      success: posted.success,
      failed: posted.failed,
      results: posted.results,
      next_action: posted.failed > 0 ? 'Reconnect freee or check mapping and retry.' : 'Review drafts in freee.',
      contact: 'https://support.freee.co.jp/hc/ja',
    },
    { status: posted.status }
  )
  applyRefreshedFreeeCookies(response, posted.freeeRefresh)
  return response
}

export async function GET(request: NextRequest) {
  const authState = auth()
  if (!authState.userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const limit = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get('limit') ?? 30)))
  const fetched = await fetchReviewQueueByProvider({
    cookieStore: cookies(),
    provider: 'freee',
    limit,
  })

  const response = NextResponse.json(
    {
      ok: fetched.ok,
      diagnostic_code: fetched.diagnostic_code,
      status: fetched.status,
      deals: fetched.queue,
      next_action: fetched.ok ? 'Review drafts in freee.' : 'Reconnect freee and retry.',
      contact: 'https://support.freee.co.jp/hc/ja',
    },
    { status: fetched.status }
  )
  applyRefreshedFreeeCookies(response, fetched.freeeRefresh)
  return response
}
