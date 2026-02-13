import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { getEnabledPacks } from '@/lib/core/packs'
import { readFreeeSession } from '@/lib/connectors/freee'

export async function GET() {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const session = readFreeeSession(cookies())

  const freeeConfigured = Boolean(
    process.env.NEXT_PUBLIC_FREEE_CLIENT_ID &&
      process.env.FREEE_CLIENT_SECRET &&
      process.env.NEXT_PUBLIC_FREEE_REDIRECT_URI
  )

  const status = {
    freee: {
      configured: freeeConfigured,
      connected: Boolean(session.accessToken),
      companyId: session.companyId,
      nextAction: session.accessToken ? 'connected' : 'open_oauth',
      mode: session.sharedMode ? 'shared_token' : 'oauth_per_user',
    },
    ocr: {
      enabled: (process.env.ENABLE_RECEIPT_OCR ?? '0') === '1',
      provider: process.env.GEMINI_API_KEY ? 'gemini' : 'none',
    },
    llm: {
      externalEnabled: (process.env.ENABLE_EXTERNAL_LLM ?? '0') === '1',
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite',
    },
    packs: getEnabledPacks().map((pack) => ({ key: pack.key, title: pack.title })),
    support_boundary: {
      owner_scope: 'oauth_connectivity_and_classification_pipeline',
      freee_scope: 'accounting_rules_and_freee_internal_processing',
    },
  }

  return NextResponse.json({ ok: true, diagnostic_code: 'CONNECTORS_STATUS_OK', status })
}
