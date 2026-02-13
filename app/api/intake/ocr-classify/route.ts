import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { extractExpenseByGeminiOcr } from '@/lib/connectors/ocr/gemini'
import { emitAuditMeta, createAuditMeta } from '@/lib/core/audit'
import { evaluateTransaction, redactSensitiveText } from '@/lib/core/decision'
import { getJurisdictionProfile } from '@/lib/core/jurisdiction'
import { resolveTenantContext } from '@/lib/core/tenant'
import type { CanonicalTransaction } from '@/lib/core/types'

export async function POST(request: NextRequest) {
  try {
    const authState = auth()
    if (!authState.userId) {
      return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })
    }

    if ((process.env.ENABLE_RECEIPT_OCR ?? '0') !== '1') {
      return NextResponse.json(
        {
          ok: false,
          diagnostic_code: 'OCR_DISABLED',
          message: 'ENABLE_RECEIPT_OCR=1 を設定するとOCR intakeを利用できます。',
        },
        { status: 403 }
      )
    }

    const body = (await request.json()) as {
      imageDataUrl?: string
      country_code?: string
      mode?: string
      region?: string
    }
    const imageDataUrl = String(body.imageDataUrl ?? '')
    if (!imageDataUrl) {
      return NextResponse.json({ ok: false, diagnostic_code: 'MISSING_IMAGE' }, { status: 400 })
    }

    const tenant = resolveTenantContext({
      auth: authState,
      regionCode: body.region ?? body.country_code ?? 'JP',
      mode: body.mode,
    })
    if (!tenant) {
      return NextResponse.json({ ok: false, diagnostic_code: 'TENANT_CONTEXT_REQUIRED' }, { status: 401 })
    }

    const countryCode = String(body.country_code ?? 'JP').toUpperCase()
    const jurisdiction = getJurisdictionProfile(countryCode)

    const ocr = await extractExpenseByGeminiOcr(imageDataUrl)
    const transaction: CanonicalTransaction = {
      transaction_id: crypto.randomUUID(),
      source_type: 'paper_ocr',
      direction: 'expense',
      occurred_at: ocr.expense_date,
      amount: Math.max(1, Math.floor(Number(ocr.amount) || 0)),
      currency: jurisdiction.currency,
      counterparty: ocr.merchant,
      memo_redacted: redactSensitiveText(ocr.description),
      country_code: jurisdiction.countryCode,
      raw_reference: 'paper-receipt',
    }

    const decision = await evaluateTransaction(transaction)

    emitAuditMeta(
      createAuditMeta({
        actor_user_id: tenant.user_id,
        organization_id: tenant.organization_id,
        event_type: 'intake_ocr_classify',
        transaction_id: transaction.transaction_id,
        decision_id: decision.decision_id,
        status: 'success',
        diagnostic_code: 'INTAKE_OCR_CLASSIFIED',
        rule_version: decision.rule_version,
        model_version: decision.model_version,
      })
    )

    return NextResponse.json({
      ok: true,
      transaction,
      decision,
      diagnostic_code: 'INTAKE_OCR_CLASSIFIED',
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'INTAKE_OCR_FAILED',
        message: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 }
    )
  }
}
