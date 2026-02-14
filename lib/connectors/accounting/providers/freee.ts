import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

import {
  fetchFreeeAccountItems,
  fetchFreeeTaxes,
  listFreeeExpenseDrafts,
  postFreeeDraftExpense,
  readFreeeSession,
  type FreeeAccountItem,
  type FreeeTax,
  type FreeeTokenResponse,
} from '@/lib/connectors/freee'
import { getProviderDefinition } from '@/lib/connectors/accounting/catalog'
import type {
  ProviderDraftResult,
  PostingCommand,
  ReviewQueueItem,
  TenantContext,
} from '@/lib/core/types'

export interface FreeeProviderStatus {
  provider: 'freee'
  label: string
  configured: boolean
  connected: boolean
  mode: 'shared_token' | 'oauth_per_user'
  account_context: string | null
  next_action: string
  contact: string
  support_name: string
  docs_url: string
}

export interface FreeePostResult {
  ok: boolean
  status: number
  diagnostic_code: string
  success: number
  failed: number
  results: ProviderDraftResult[]
  refreshed: FreeeTokenResponse | null
}

export interface FreeeReviewResult {
  ok: boolean
  status: number
  diagnostic_code: string
  queue: ReviewQueueItem[]
  refreshed: FreeeTokenResponse | null
}

const TAX_MAN_DRAFT_MARKER = '[Tax man]'

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

function mapStatusCodeToDiagnostic(status: number): string {
  if (status === 200 || status === 201) return 'FREEE_DRAFT_POSTED'
  if (status === 400) return 'FREEE_BAD_REQUEST'
  if (status === 401) return 'FREEE_AUTH_EXPIRED'
  if (status === 403) return 'FREEE_PERMISSION_DENIED'
  if (status >= 500) return 'FREEE_SERVER_ERROR'
  return 'FREEE_POST_FAILED'
}

function buildTaxManDraftDescription(command: PostingCommand): string {
  const reason = String(command.decision.reason || command.transaction.memo_redacted || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  const shortId = command.transaction.transaction_id.slice(0, 8)
  return `${TAX_MAN_DRAFT_MARKER} tx:${shortId} ${reason}`.trim()
}

export function getFreeeStatus(cookieStore: ReadonlyRequestCookies): FreeeProviderStatus {
  const definition = getProviderDefinition('freee')
  const session = readFreeeSession(cookieStore)
  const configured = Boolean(
    process.env.NEXT_PUBLIC_FREEE_CLIENT_ID &&
      process.env.FREEE_CLIENT_SECRET &&
      process.env.NEXT_PUBLIC_FREEE_REDIRECT_URI
  )

  return {
    provider: 'freee',
    label: definition.label,
    configured,
    connected: Boolean(session.accessToken),
    mode: session.sharedMode ? 'shared_token' : 'oauth_per_user',
    account_context: session.companyId ? String(session.companyId) : null,
    next_action: session.accessToken ? 'connected' : 'start_oauth',
    contact: definition.support.url,
    support_name: definition.support.name,
    docs_url: definition.docsUrl,
  }
}

export async function postFreeeDrafts(args: {
  cookieStore: ReadonlyRequestCookies
  commands: PostingCommand[]
  tenant: TenantContext
}): Promise<FreeePostResult> {
  const definition = getProviderDefinition('freee')
  const session = readFreeeSession(args.cookieStore)

  if (!session.accessToken) {
    const results: ProviderDraftResult[] = args.commands.map((command) => ({
      provider: 'freee',
      transaction_id: command.transaction.transaction_id,
      ok: false,
      status: 401,
      diagnostic_code: 'FREEE_NOT_CONNECTED',
      message: 'freee未接続です。',
      next_action: 'Connect freee OAuth and retry.',
      contact: definition.support.url,
    }))
    return {
      ok: false,
      status: 401,
      diagnostic_code: 'FREEE_NOT_CONNECTED',
      success: 0,
      failed: results.length,
      results,
      refreshed: null,
    }
  }

  if (!session.companyId) {
    const results: ProviderDraftResult[] = args.commands.map((command) => ({
      provider: 'freee',
      transaction_id: command.transaction.transaction_id,
      ok: false,
      status: 400,
      diagnostic_code: 'FREEE_COMPANY_MISSING',
      message: 'freee company_id が未設定です。',
      next_action: 'Select a company and retry.',
      contact: definition.support.url,
    }))
    return {
      ok: false,
      status: 400,
      diagnostic_code: 'FREEE_COMPANY_MISSING',
      success: 0,
      failed: results.length,
      results,
      refreshed: null,
    }
  }

  const postable = args.commands.filter(
    (command) =>
      command?.decision?.is_expense &&
      command.decision.allocation_rate > 0 &&
      command.transaction?.amount > 0
  )

  if (postable.length === 0) {
    return {
      ok: false,
      status: 400,
      diagnostic_code: 'NO_POSTABLE_COMMANDS',
      success: 0,
      failed: 0,
      results: [],
      refreshed: null,
    }
  }

  let activeSession = { ...session }

  const accountItemsResult = await fetchFreeeAccountItems(activeSession)
  if (accountItemsResult.refreshed?.access_token) {
    activeSession = {
      ...activeSession,
      accessToken: accountItemsResult.refreshed.access_token,
      refreshToken: accountItemsResult.refreshed.refresh_token ?? activeSession.refreshToken,
    }
  }

  if (accountItemsResult.status !== 200 || accountItemsResult.accountItems.length === 0) {
    return {
      ok: false,
      status: accountItemsResult.status || 500,
      diagnostic_code: 'FREEE_ACCOUNT_ITEMS_UNAVAILABLE',
      success: 0,
      failed: postable.length,
      results: postable.map((command) => ({
        provider: 'freee',
        transaction_id: command.transaction.transaction_id,
        ok: false,
        status: accountItemsResult.status || 500,
        diagnostic_code: 'FREEE_ACCOUNT_ITEMS_UNAVAILABLE',
        message: 'freee勘定科目の取得に失敗しました。',
        next_action: 'Check provider settings and retry.',
        contact: definition.support.url,
      })),
      refreshed: accountItemsResult.refreshed,
    }
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
    return {
      ok: false,
      status: taxResult.status || 500,
      diagnostic_code: 'FREEE_TAX_CODE_UNAVAILABLE',
      success: 0,
      failed: postable.length,
      results: postable.map((command) => ({
        provider: 'freee',
        transaction_id: command.transaction.transaction_id,
        ok: false,
        status: taxResult.status || 500,
        diagnostic_code: 'FREEE_TAX_CODE_UNAVAILABLE',
        message: 'freee税区分の取得に失敗しました。',
        next_action: 'Check tax settings in freee.',
        contact: definition.support.url,
      })),
      refreshed: taxResult.refreshed,
    }
  }

  const taxCode = pickTaxCode(taxResult.taxes)
  if (!taxCode) {
    return {
      ok: false,
      status: 500,
      diagnostic_code: 'FREEE_TAX_CODE_UNAVAILABLE',
      success: 0,
      failed: postable.length,
      results: postable.map((command) => ({
        provider: 'freee',
        transaction_id: command.transaction.transaction_id,
        ok: false,
        status: 500,
        diagnostic_code: 'FREEE_TAX_CODE_UNAVAILABLE',
        message: 'freee税区分が見つかりませんでした。',
        next_action: 'Set default tax in freee and retry.',
        contact: definition.support.url,
      })),
      refreshed: taxResult.refreshed,
    }
  }

  const results: ProviderDraftResult[] = []
  let latestRefresh = taxResult.refreshed ?? accountItemsResult.refreshed ?? null

  for (const command of postable) {
    const accountItemId = pickAccountItemId(command.decision.category, accountItemsResult.accountItems)
    if (!accountItemId) {
      results.push({
        provider: 'freee',
        transaction_id: command.transaction.transaction_id,
        ok: false,
        status: 400,
        diagnostic_code: 'ACCOUNT_ITEM_MAPPING_FAILED',
        message: '勘定科目の自動マッピングに失敗しました。',
        next_action: 'Adjust category and retry.',
        contact: definition.support.url,
      })
      continue
    }

    const allocatedAmount = Math.max(1, Math.floor(command.transaction.amount * command.decision.allocation_rate))

    const posted = await postFreeeDraftExpense({
      session: activeSession,
      issueDate: command.decision.date,
      accountItemId,
      taxCode,
      amount: allocatedAmount,
      description: buildTaxManDraftDescription(command),
    })

    if (posted.refreshed?.access_token) {
      activeSession = {
        ...activeSession,
        accessToken: posted.refreshed.access_token,
        refreshToken: posted.refreshed.refresh_token ?? activeSession.refreshToken,
      }
      latestRefresh = posted.refreshed
    }

    const bodyRecord = posted.body as { deal?: { id?: number | string } } | null
    const diagnostic = mapStatusCodeToDiagnostic(posted.status)
    results.push({
      provider: 'freee',
      transaction_id: command.transaction.transaction_id,
      ok: posted.ok,
      status: posted.status,
      freee_deal_id: typeof bodyRecord?.deal?.id === 'number' ? bodyRecord.deal.id : null,
      freee_request_id: posted.requestId,
      remote_id: bodyRecord?.deal?.id ?? null,
      request_id: posted.requestId,
      diagnostic_code: diagnostic,
      message: posted.ok ? 'freee下書きへ送信しました。' : 'freee送信に失敗しました。',
      next_action: posted.ok ? 'Review the draft in freee.' : 'Reconnect provider and retry.',
      contact: definition.support.url,
    })
  }

  const success = results.filter((result) => result.ok).length
  const failed = results.length - success

  return {
    ok: failed === 0,
    status: failed === 0 ? 200 : 207,
    diagnostic_code: failed === 0 ? 'FREEE_DRAFT_POSTED' : 'FREEE_DRAFT_PARTIAL_FAILURE',
    success,
    failed,
    results,
    refreshed: latestRefresh,
  }
}

export async function fetchFreeeReviewQueue(args: {
  cookieStore: ReadonlyRequestCookies
  limit?: number
}): Promise<FreeeReviewResult> {
  const definition = getProviderDefinition('freee')
  const session = readFreeeSession(args.cookieStore)

  if (!session.accessToken || !session.companyId) {
    return {
      ok: false,
      status: 401,
      diagnostic_code: 'FREEE_NOT_CONNECTED',
      queue: [],
      refreshed: null,
    }
  }

  const fetched = await listFreeeExpenseDrafts({ session, limit: args.limit })

  if (!fetched.ok) {
    return {
      ok: false,
      status: fetched.status,
      diagnostic_code: 'FREEE_QUEUE_FETCH_FAILED',
      queue: [],
      refreshed: fetched.refreshed,
    }
  }

  const queue: ReviewQueueItem[] = fetched.deals
    .filter((deal) => String(deal.description ?? '').includes(TAX_MAN_DRAFT_MARKER))
    .map((deal) => {
    const id = Number(deal.id ?? 0)
    const amount = Number(deal.amount ?? 0)
    const memoSource = String(deal.description ?? deal.ref_number ?? '')

    return {
      provider: 'freee',
      id: Number.isFinite(id) ? id : null,
      issue_date: String(deal.issue_date ?? ''),
      amount: Number.isFinite(amount) ? amount : 0,
      status: String(deal.status ?? deal.type ?? 'draft'),
      memo: memoSource.replace(TAX_MAN_DRAFT_MARKER, '').trim().slice(0, 120),
      next_action: 'Review and finalize in freee.',
      contact: definition.support.url,
    }
  })

  return {
    ok: true,
    status: 200,
    diagnostic_code: 'FREEE_QUEUE_FETCHED',
    queue,
    refreshed: fetched.refreshed,
  }
}
