import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { persistTransaction } from '@/lib/db/transactions'
import { emitAuditMeta, createAuditMeta } from '@/lib/core/audit'
import { evaluateTransaction, redactSensitiveText } from '@/lib/core/decision'
import { getJurisdictionProfile } from '@/lib/core/jurisdiction'
import { resolveTenantContext } from '@/lib/core/tenant'
import type { CanonicalTransaction } from '@/lib/core/types'

function normalizeDate(input: string): string {
  const text = String(input ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

export async function POST(request: NextRequest) {
  try {
    const authState = auth()
    if (!authState.userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

    const body = (await request.json()) as {
      date?: string
      amount?: number
      description?: string
      direction?: 'income' | 'expense'
      source_type?: 'manual' | 'connector_api'
      country_code?: string
      counterparty?: string
      mode?: string
      region?: string
    }

    const tenant = resolveTenantContext({
      auth: authState,
      regionCode: body.region ?? body.country_code ?? 'JP',
      mode: body.mode,
    })
    if (!tenant) {
      return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })
    }

    const amount = Math.floor(Number(body.amount ?? 0))
    const description = String(body.description ?? '').trim()
    if (!description || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        {
          ok: false,
          diagnostic_code: 'INVALID_MANUAL_INPUT',
          message: 'description と amount(>0) が必要です。',
        },
        { status: 400 }
      )
    }

    const jurisdiction = getJurisdictionProfile(body.country_code ?? 'JP')
    const transaction: CanonicalTransaction = {
      transaction_id: crypto.randomUUID(),
      source_type: body.source_type ?? 'manual',
      direction: body.direction ?? 'expense',
      occurred_at: normalizeDate(String(body.date ?? '')),
      amount,
      currency: jurisdiction.currency,
      counterparty: body.counterparty,
      memo_redacted: redactSensitiveText(description),
      country_code: jurisdiction.countryCode,
      raw_reference: 'manual-entry',
    }

    const decision = await evaluateTransaction(transaction)

    emitAuditMeta(
      createAuditMeta({
        actor_user_id: tenant.user_id,
        organization_id: tenant.organization_id,
        event_type: 'intake_manual_classify',
        transaction_id: transaction.transaction_id,
        decision_id: decision.decision_id,
        status: 'success',
        diagnostic_code: 'INTAKE_MANUAL_CLASSIFIED',
        rule_version: decision.rule_version,
        model_version: decision.model_version,
      })
    )

    try {
      await persistTransaction(tenant, transaction, decision)
    } catch (dbErr) {
      // Log but do not fail: allow operation when Supabase is not configured
      console.warn('[intake/manual] persist failed:', dbErr)
    }

    return NextResponse.json({ ok: true, transaction, decision, diagnostic_code: 'INTAKE_MANUAL_CLASSIFIED' })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'INTAKE_MANUAL_FAILED',
        message: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 }
    )
  }
}
