import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { applyRefreshedFreeeCookies } from '@/lib/connectors/freee'
import { postDraftsByProvider, resolveProvider } from '@/lib/connectors/accounting/router'
import { getPostableTransactions, updatePostingResult } from '@/lib/db/transactions'
import { createAuditMeta, emitAuditMeta } from '@/lib/core/audit'
import { resolveTenantContext } from '@/lib/core/tenant'

const DEFAULT_MIN_CONFIDENCE = 0.85

export async function POST(request: NextRequest) {
  try {
    const authState = auth()
    if (!authState.userId) {
      return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      region?: string
      provider?: string
      mode?: string
      min_confidence?: number
    }

    const tenant = resolveTenantContext({
      auth: authState,
      regionCode: body.region,
      mode: body.mode,
    })
    if (!tenant) {
      return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })
    }

    const minConfidence =
      typeof body.min_confidence === 'number' && body.min_confidence >= 0 && body.min_confidence <= 1
        ? body.min_confidence
        : parseFloat(process.env.AUTOPOST_CONFIDENCE_THRESHOLD ?? '') || DEFAULT_MIN_CONFIDENCE

    let commands
    try {
      commands = await getPostableTransactions(tenant, minConfidence)
    } catch (dbErr) {
      console.warn('[auto-post] getPostableTransactions failed:', dbErr)
      return NextResponse.json({ ok: true, success: 0, failed: 0, results: [], message: 'DB unavailable' })
    }

    if (commands.length === 0) {
      return NextResponse.json({
        ok: true,
        success: 0,
        failed: 0,
        results: [],
        message: '送信対象がありません。',
      })
    }

    const routing = resolveProvider({
      regionCode: body.region ?? tenant.region_code,
      requestedProvider: body.provider,
    })

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
        event_type: 'auto_post_run',
        status: posted.failed === 0 ? 'success' : 'error',
        diagnostic_code: posted.diagnostic_code,
      })
    )

    for (const result of posted.results ?? []) {
      if (result.ok) {
        try {
          await updatePostingResult(tenant, result.transaction_id, {
            ...result,
            provider: result.provider ?? routing.provider,
          })
        } catch {
          // ignore
        }
      }
    }

    const response = NextResponse.json({
      ok: posted.ok,
      provider: routing.provider,
      success: posted.success,
      failed: posted.failed,
      results: posted.results,
      message: `自動送信: 成功 ${posted.success} / 失敗 ${posted.failed}`,
    })

    if (routing.provider === 'freee') {
      applyRefreshedFreeeCookies(response, posted.freeeRefresh)
    }

    return response
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'AUTO_POST_FAILED',
        message: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 }
    )
  }
}
