import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { persistTransaction } from '@/lib/db/transactions'
import { evaluateTransaction, redactSensitiveText } from '@/lib/core/decision'
import { getJurisdictionProfile } from '@/lib/core/jurisdiction'
import { resolveTenantContext } from '@/lib/core/tenant'
import { fetchStripeCharges } from '@/lib/connectors/stripe'
import type { CanonicalTransaction } from '@/lib/core/types'

/**
 * Stripe 決済取引を取得し、主帳簿へ取り込む
 * STRIPE_SECRET_KEY が必要
 */
export async function POST(request: NextRequest) {
  try {
    const authState = auth()
    if (!authState.userId) {
      return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      limit?: number
      region?: string
      country_code?: string
    }

    const tenant = resolveTenantContext({
      auth: authState,
      regionCode: body.region ?? body.country_code ?? 'JP',
    })
    if (!tenant) {
      return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })
    }

    const limit = Math.min(Math.max(body.limit ?? 50, 1), 100)
    const rows = await fetchStripeCharges(limit)

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        message: 'Stripeに取り込む取引がありません。',
      })
    }

    const jurisdiction = getJurisdictionProfile(body.country_code ?? 'US')
    let processed = 0

    for (const row of rows) {
      const transaction: CanonicalTransaction = {
        transaction_id: crypto.randomUUID(),
        source_type: 'card_feed',
        direction: row.direction,
        occurred_at: row.date,
        amount: Math.abs(Math.floor(row.amount)),
        currency: row.currency ?? jurisdiction.currency,
        counterparty: row.counterparty,
        memo_redacted: redactSensitiveText(row.description),
        country_code: jurisdiction.countryCode,
        raw_reference: `stripe:${row.id}`,
      }
      const decision = await evaluateTransaction(transaction)
      try {
        await persistTransaction(tenant, transaction, decision)
        processed += 1
      } catch {
        // skip on conflict or DB error
      }
    }

    return NextResponse.json({
      ok: true,
      processed,
      message: `Stripe同期: ${processed}件を取り込みました。`,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'STRIPE_SYNC_FAILED',
        message: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 }
    )
  }
}
