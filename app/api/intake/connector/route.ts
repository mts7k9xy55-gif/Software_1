import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { persistTransaction } from '@/lib/db/transactions'
import { emitAuditMeta, createAuditMeta } from '@/lib/core/audit'
import { evaluateTransaction, redactSensitiveText } from '@/lib/core/decision'
import { getJurisdictionProfile } from '@/lib/core/jurisdiction'
import { resolveTenantContext } from '@/lib/core/tenant'
import type { CanonicalTransaction, SourceType } from '@/lib/core/types'

const ALLOWED_SOURCE_TYPES: SourceType[] = ['bank_feed', 'card_feed', 'connector_api']

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
    if (!authState.userId) {
      return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })
    }

    const body = (await request.json()) as {
      source_type?: 'bank_feed' | 'card_feed' | 'connector_api'
      country_code?: string
      region?: string
      mode?: string
      transactions?: Array<{
        date?: string
        amount?: number
        description?: string
        direction?: 'income' | 'expense'
        counterparty?: string
        currency?: string
      }>
    }

    const sourceType = body.source_type ?? 'connector_api'
    if (!ALLOWED_SOURCE_TYPES.includes(sourceType)) {
      return NextResponse.json(
        { ok: false, diagnostic_code: 'INVALID_SOURCE_TYPE', message: 'source_type must be bank_feed, card_feed, or connector_api' },
        { status: 400 }
      )
    }

    const tenant = resolveTenantContext({
      auth: authState,
      regionCode: body.region ?? body.country_code ?? 'JP',
      mode: body.mode,
    })
    if (!tenant) {
      return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })
    }

    const rawTransactions = Array.isArray(body.transactions) ? body.transactions.slice(0, 200) : []
    if (rawTransactions.length === 0) {
      return NextResponse.json(
        { ok: false, diagnostic_code: 'NO_TRANSACTIONS', message: 'transactions array is required' },
        { status: 400 }
      )
    }

    const jurisdiction = getJurisdictionProfile(body.country_code ?? 'JP')
    const results: Array<{ transaction: CanonicalTransaction; decision: Awaited<ReturnType<typeof evaluateTransaction>> }> = []

    for (const row of rawTransactions) {
      const amount = Math.floor(Number(row.amount ?? 0))
      const description = String(row.description ?? '').trim()
      if (!description || !Number.isFinite(amount) || amount <= 0) continue

      const transaction: CanonicalTransaction = {
        transaction_id: crypto.randomUUID(),
        source_type: sourceType,
        direction: /income|sale|revenue|売上|収入/i.test(String(row.direction ?? '')) ? 'income' : 'expense',
        occurred_at: normalizeDate(String(row.date ?? '')),
        amount: Math.abs(amount),
        currency: row.currency ?? jurisdiction.currency,
        counterparty: row.counterparty,
        memo_redacted: redactSensitiveText(description),
        country_code: jurisdiction.countryCode,
        raw_reference: `${sourceType}-import`,
      }

      const decision = await evaluateTransaction(transaction)
      results.push({ transaction, decision })

      emitAuditMeta(
        createAuditMeta({
          actor_user_id: tenant.user_id,
          organization_id: tenant.organization_id,
          event_type: 'intake_connector_classify',
          transaction_id: transaction.transaction_id,
          decision_id: decision.decision_id,
          status: 'success',
          diagnostic_code: 'INTAKE_CONNECTOR_CLASSIFIED',
          rule_version: decision.rule_version,
          model_version: decision.model_version,
        })
      )

      try {
        await persistTransaction(tenant, transaction, decision)
      } catch (dbErr) {
        console.warn('[intake/connector] persist failed for', transaction.transaction_id, dbErr)
      }
    }

    return NextResponse.json({
      ok: true,
      processed: results.length,
      results: results.map((r) => ({ transaction: r.transaction, decision: r.decision })),
      diagnostic_code: 'INTAKE_CONNECTOR_CLASSIFIED',
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'INTAKE_CONNECTOR_FAILED',
        message: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 }
    )
  }
}
