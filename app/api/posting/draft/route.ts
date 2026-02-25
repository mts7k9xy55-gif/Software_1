import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { applyRefreshedFreeeCookies } from '@/lib/connectors/freee'
import { postDraftsByProvider, resolveProvider } from '@/lib/connectors/accounting/router'
import { updatePostingResult } from '@/lib/db/transactions'
import { createAuditMeta, emitAuditMeta } from '@/lib/core/audit'
import { resolveTenantContext } from '@/lib/core/tenant'
import type { PostingCommand } from '@/lib/core/types'

export async function POST(request: NextRequest) {
  const authState = auth()
  if (!authState.userId) {
    return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    region?: string
    provider?: string
    mode?: string
    commands?: PostingCommand[]
  }

  const tenant = resolveTenantContext({
    auth: authState,
    regionCode: body.region,
    mode: body.mode,
  })

  if (!tenant) {
    return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })
  }

  const routing = resolveProvider({
    regionCode: body.region ?? tenant.region_code,
    requestedProvider: body.provider,
  })

  const commands = Array.isArray(body.commands) ? body.commands : []

  const posted = await postDraftsByProvider({
    cookieStore: cookies(),
    provider: routing.provider,
    commands,
    tenant,
  })

  emitAuditMeta(
    createAuditMeta({
      actor_user_id: tenant.user_id,
      organization_id: tenant.organization_id,
      provider: routing.provider,
      event_type: 'posting_draft',
      status: posted.failed === 0 ? 'success' : 'error',
      diagnostic_code: posted.diagnostic_code,
      model_version: commands[0]?.decision?.model_version,
      rule_version: commands[0]?.decision?.rule_version,
    })
  )

  for (const result of posted.results ?? []) {
    if (result.ok) {
      try {
        await updatePostingResult(tenant, result.transaction_id, {
          ...result,
          provider: result.provider ?? routing.provider,
        })
      } catch (dbErr) {
        console.warn('[posting/draft] updatePostingResult failed:', dbErr)
      }
    }
  }

  const response = NextResponse.json(
    {
      ok: posted.ok,
      provider: routing.provider,
      diagnostic_code: posted.diagnostic_code,
      success: posted.success,
      failed: posted.failed,
      results: posted.results,
      next_action:
        posted.failed > 0 ? 'Check diagnostic_code and reconnect provider if needed.' : 'Review drafts in provider UI.',
      contact: routing.definition.support.url,
    },
    { status: posted.status }
  )

  if (routing.provider === 'freee') {
    applyRefreshedFreeeCookies(response, posted.freeeRefresh)
  }

  return response
}
