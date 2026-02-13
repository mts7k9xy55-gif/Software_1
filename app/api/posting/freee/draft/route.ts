import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import {
  applyRefreshedFreeeCookies,
  fetchFreeeAccountItems,
  fetchFreeeTaxes,
  listFreeeExpenseDrafts,
  postFreeeDraftExpense,
  readFreeeSession,
  type FreeeAccountItem,
  type FreeeTax,
  type FreeeSession,
} from '@/lib/connectors/freee'
import { createAuditMeta, emitAuditMeta } from '@/lib/core/audit'
import type { PostingCommand, PostingResult } from '@/lib/core/types'

function pickTaxCode(taxes: FreeeTax[]): number | null {
  const preferredRaw = ['purchase_with_tax_10', 'purchase_without_tax_10', 'purchase_with_tax_8']
  const byRaw = taxes.find((tax) => preferredRaw.includes(String(tax.name ?? '').trim()))
  if (byRaw?.code) return byRaw.code

  const byLabel = taxes.find((tax) => String(tax.name_ja ?? '').includes('課税仕入'))
  if (byLabel?.code) return byLabel.code

  return taxes[0]?.code ?? null
}

function pickAccountItemId(category: string, accountItems: FreeeAccountItem[]): number | null {
  const normalized = String(category).toLowerCase()
  const keywordMap: Array<{ keys: string[]; accountKeywords: string[] }> = [
    { keys: ['通信', 'internet', 'hosting'], accountKeywords: ['通信費'] },
    { keys: ['仕入', '食材', 'inventory'], accountKeywords: ['仕入'] },
    { keys: ['消耗', '備品', 'supplies'], accountKeywords: ['消耗品'] },
    { keys: ['広告', 'ad'], accountKeywords: ['広告'] },
    { keys: ['交通', '運賃', '配送'], accountKeywords: ['荷造運賃', '旅費交通費'] },
  ]

  for (const mapping of keywordMap) {
    if (!mapping.keys.some((key) => normalized.includes(key))) continue
    const found = accountItems.find((item) =>
      mapping.accountKeywords.some((kw) => String(item.name).includes(kw))
    )
    if (found) return found.id
  }

  const fallback = accountItems.find((item) => ['雑費', '消耗品'].some((kw) => item.name.includes(kw)))
  return fallback?.id ?? accountItems[0]?.id ?? null
}

function toDiagnostic(status: number): string {
  if (status === 200 || status === 201) return 'FREEE_DRAFT_POSTED'
  if (status === 401) return 'FREEE_AUTH_EXPIRED'
  if (status === 403) return 'FREEE_PERMISSION_DENIED'
  if (status >= 500) return 'FREEE_SERVER_ERROR'
  return 'FREEE_POST_FAILED'
}

export async function POST(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const session = readFreeeSession(cookies())
  if (!session.accessToken) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'FREEE_NOT_CONNECTED',
        message: 'freeeに未接続です。/api/freee/oauth/start で接続してください。',
      },
      { status: 401 }
    )
  }
  if (!session.companyId) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'FREEE_COMPANY_MISSING',
        message: 'freee company_id が未設定です。',
      },
      { status: 400 }
    )
  }

  const body = (await request.json().catch(() => ({}))) as { commands?: PostingCommand[] }
  const commands = Array.isArray(body.commands) ? body.commands : []

  const postable = commands.filter(
    (command) =>
      command?.decision?.is_expense &&
      command.decision.allocation_rate > 0 &&
      command.transaction?.amount > 0
  )

  if (postable.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        diagnostic_code: 'NO_POSTABLE_COMMANDS',
        message: 'is_expense=true かつ allocation_rate>0 の取引がありません。',
      },
      { status: 400 }
    )
  }

  let activeSession: FreeeSession = { ...session }

  const accountItemsResult = await fetchFreeeAccountItems(activeSession)
  if (accountItemsResult.refreshed?.access_token) {
    activeSession = {
      ...activeSession,
      accessToken: accountItemsResult.refreshed.access_token,
      refreshToken: accountItemsResult.refreshed.refresh_token ?? activeSession.refreshToken,
    }
  }
  if (accountItemsResult.status !== 200 || accountItemsResult.accountItems.length === 0) {
    return NextResponse.json(
      { ok: false, diagnostic_code: 'FREEE_ACCOUNT_ITEMS_UNAVAILABLE' },
      { status: accountItemsResult.status || 500 }
    )
  }

  const taxResult = await fetchFreeeTaxes(activeSession)
  if (taxResult.refreshed?.access_token) {
    activeSession = {
      ...activeSession,
      accessToken: taxResult.refreshed.access_token,
      refreshToken: taxResult.refreshed.refresh_token ?? activeSession.refreshToken,
    }
  }
  if (taxResult.status !== 200 || taxResult.taxes.length === 0) {
    return NextResponse.json(
      { ok: false, diagnostic_code: 'FREEE_TAX_CODE_UNAVAILABLE' },
      { status: taxResult.status || 500 }
    )
  }

  const taxCode = pickTaxCode(taxResult.taxes)
  if (!taxCode) {
    return NextResponse.json({ ok: false, diagnostic_code: 'FREEE_TAX_CODE_UNAVAILABLE' }, { status: 500 })
  }

  const results: PostingResult[] = []
  let latestRefresh = taxResult.refreshed ?? accountItemsResult.refreshed ?? null

  for (const command of postable) {
    const accountItemId = pickAccountItemId(command.decision.category, accountItemsResult.accountItems)
    if (!accountItemId) {
      results.push({
        transaction_id: command.transaction.transaction_id,
        ok: false,
        status: 400,
        diagnostic_code: 'ACCOUNT_ITEM_MAPPING_FAILED',
        message: '勘定科目マッピングに失敗しました。',
      })
      continue
    }

    const allocatedAmount = Math.max(
      1,
      Math.floor(command.transaction.amount * command.decision.allocation_rate)
    )

    const posted = await postFreeeDraftExpense({
      session: activeSession,
      issueDate: command.decision.date,
      accountItemId,
      taxCode,
      amount: allocatedAmount,
      description: command.decision.reason || command.transaction.memo_redacted,
    })

    if (posted.refreshed?.access_token) {
      activeSession = {
        ...activeSession,
        accessToken: posted.refreshed.access_token,
        refreshToken: posted.refreshed.refresh_token ?? activeSession.refreshToken,
      }
      latestRefresh = posted.refreshed
    }

    const bodyRecord = posted.body as { deal?: { id?: number } } | null
    results.push({
      transaction_id: command.transaction.transaction_id,
      ok: posted.ok,
      status: posted.status,
      freee_deal_id: bodyRecord?.deal?.id ?? null,
      freee_request_id: posted.requestId,
      diagnostic_code: toDiagnostic(posted.status),
      message: posted.ok ? 'freee下書きへ送信しました。' : 'freee送信に失敗しました。',
    })
  }

  const okCount = results.filter((result) => result.ok).length
  const errorCount = results.length - okCount

  emitAuditMeta(
    createAuditMeta({
      actor_user_id: userId,
      event_type: 'posting_freee_draft',
      status: errorCount === 0 ? 'success' : 'error',
      diagnostic_code: errorCount === 0 ? 'FREEE_DRAFT_POSTED' : 'FREEE_DRAFT_PARTIAL_FAILURE',
      model_version: postable[0]?.decision?.model_version,
      rule_version: postable[0]?.decision?.rule_version,
    })
  )

  const response = NextResponse.json({
    ok: true,
    diagnostic_code: errorCount === 0 ? 'FREEE_DRAFT_POSTED' : 'FREEE_DRAFT_PARTIAL_FAILURE',
    success: okCount,
    failed: errorCount,
    results,
  })

  applyRefreshedFreeeCookies(response, latestRefresh)
  return response
}

export async function GET() {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, diagnostic_code: 'AUTH_REQUIRED' }, { status: 401 })

  const session = readFreeeSession(cookies())
  if (!session.accessToken || !session.companyId) {
    return NextResponse.json({ ok: false, diagnostic_code: 'FREEE_NOT_CONNECTED' }, { status: 401 })
  }

  const result = await listFreeeExpenseDrafts({ session, limit: 30 })
  const response = NextResponse.json({
    ok: result.ok,
    diagnostic_code: result.ok ? 'FREEE_REVIEW_QUEUE_OK' : 'FREEE_REVIEW_QUEUE_FAILED',
    status: result.status,
    deals: result.deals,
  })
  applyRefreshedFreeeCookies(response, result.refreshed)
  return response
}
