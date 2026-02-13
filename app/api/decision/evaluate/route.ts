import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { emitAuditMeta, createAuditMeta } from '@/lib/core/audit'
import { evaluateTransaction } from '@/lib/core/decision'
import type { CanonicalTransaction } from '@/lib/core/types'

export async function POST(request: NextRequest) {
  try {
    const { userId } = auth()
    if (!userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

    const body = (await request.json()) as { transaction?: CanonicalTransaction }
    const transaction = body.transaction
    if (!transaction?.transaction_id) {
      return NextResponse.json(
        { ok: false, diagnostic_code: 'MISSING_TRANSACTION' },
        { status: 400 }
      )
    }

    const decision = await evaluateTransaction(transaction)
    emitAuditMeta(
      createAuditMeta({
        actor_user_id: userId,
        event_type: 'decision_evaluate',
        transaction_id: transaction.transaction_id,
        decision_id: decision.decision_id,
        status: 'success',
        diagnostic_code: 'DECISION_EVALUATED',
        rule_version: decision.rule_version,
        model_version: decision.model_version,
      })
    )

    return NextResponse.json({ ok: true, decision, diagnostic_code: 'DECISION_EVALUATED' })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'DECISION_EVALUATE_FAILED',
        message: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 }
    )
  }
}
