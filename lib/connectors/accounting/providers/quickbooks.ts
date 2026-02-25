import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

import { getProviderDefinition } from '@/lib/connectors/accounting/catalog'
import type {
  PostingCommand,
  ProviderDraftResult,
  ReviewQueueItem,
} from '@/lib/core/types'

interface QuickBooksSession {
  accessToken: string
  refreshToken: string
  realmId: string
  sharedMode: boolean
}

export interface QuickBooksProviderStatus {
  provider: 'quickbooks'
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

function readQuickBooksSession(cookieStore: ReadonlyRequestCookies): QuickBooksSession {
  const cookieAccess = cookieStore.get('qbo_access_token')?.value ?? ''
  const cookieRefresh = cookieStore.get('qbo_refresh_token')?.value ?? ''
  const cookieRealm = cookieStore.get('qbo_realm_id')?.value ?? ''

  const sharedMode = (process.env.QBO_SHARED_MODE ?? '0') === '1'
  const sharedAccess = process.env.QBO_SHARED_ACCESS_TOKEN ?? ''
  const sharedRefresh = process.env.QBO_SHARED_REFRESH_TOKEN ?? ''
  const sharedRealm = process.env.QBO_SHARED_REALM_ID ?? ''

  return {
    accessToken: cookieAccess || (sharedMode ? sharedAccess : ''),
    refreshToken: cookieRefresh || (sharedMode ? sharedRefresh : ''),
    realmId: cookieRealm || (sharedMode ? sharedRealm : ''),
    sharedMode,
  }
}

const QBO_BASE = 'https://quickbooks.api.intuit.com/v3/company'

async function fetchQboExpenseAccount(accessToken: string, realmId: string): Promise<string | null> {
  const query = encodeURIComponent("select * from Account where AccountType='Expense' MAXRESULTS 1")
  const res = await fetch(`${QBO_BASE}/${realmId}/query?query=${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const json = (await res.json()) as { QueryResponse?: { Account?: Array<{ Id?: string }> } }
  return json.QueryResponse?.Account?.[0]?.Id ?? null
}

function buildPurchasePayload(
  command: PostingCommand,
  expenseAccountId: string
): Record<string, unknown> {
  const amount = Math.max(1, Math.floor(command.transaction.amount * command.decision.allocation_rate))
  const desc = `[Tax man] ${command.transaction.memo_redacted}`.slice(0, 100)
  return {
    PaymentType: 'Cash',
    AccountRef: { value: expenseAccountId },
    TxnDate: command.decision.date,
    Line: [
      {
        Amount: amount,
        Description: desc,
        DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: expenseAccountId },
        },
      },
    ],
  }
}

export function getQuickBooksStatus(cookieStore: ReadonlyRequestCookies): QuickBooksProviderStatus {
  const definition = getProviderDefinition('quickbooks')
  const session = readQuickBooksSession(cookieStore)
  const configured = Boolean(
    process.env.QBO_CLIENT_ID &&
      process.env.QBO_CLIENT_SECRET &&
      process.env.QBO_REDIRECT_URI
  )

  return {
    provider: 'quickbooks',
    label: definition.label,
    configured,
    connected: Boolean(session.accessToken && session.realmId),
    mode: session.sharedMode ? 'shared_token' : 'oauth_per_user',
    account_context: session.realmId || null,
    next_action: session.accessToken && session.realmId ? 'connected' : 'start_oauth',
    contact: definition.support.url,
    support_name: definition.support.name,
    docs_url: definition.docsUrl,
  }
}

export async function postQuickBooksDrafts(args: {
  cookieStore: ReadonlyRequestCookies
  commands: PostingCommand[]
}): Promise<{
  ok: boolean
  status: number
  diagnostic_code: string
  success: number
  failed: number
  results: ProviderDraftResult[]
}> {
  const session = readQuickBooksSession(args.cookieStore)
  const definition = getProviderDefinition('quickbooks')

  if (!session.accessToken || !session.realmId) {
    const results: ProviderDraftResult[] = args.commands.map((command) => ({
      provider: 'quickbooks',
      transaction_id: command.transaction.transaction_id,
      ok: false,
      status: 401,
      diagnostic_code: 'QBO_NOT_CONNECTED',
      message: 'QuickBooks未接続です。',
      next_action: 'Connect QuickBooks OAuth and retry.',
      contact: definition.support.url,
    }))

    return {
      ok: false,
      status: 401,
      diagnostic_code: 'QBO_NOT_CONNECTED',
      success: 0,
      failed: results.length,
      results,
    }
  }

  const expenseAccountId = await fetchQboExpenseAccount(session.accessToken, session.realmId)
  if (!expenseAccountId) {
    const results: ProviderDraftResult[] = args.commands.map((command) => ({
      provider: 'quickbooks',
      transaction_id: command.transaction.transaction_id,
      ok: false,
      status: 400,
      diagnostic_code: 'QBO_EXPENSE_ACCOUNT_NOT_FOUND',
      message: 'QuickBooksに経費勘定がありません。',
      next_action: 'Create an Expense account in QuickBooks and retry.',
      contact: definition.support.url,
    }))
    return { ok: false, status: 400, diagnostic_code: 'QBO_EXPENSE_ACCOUNT_NOT_FOUND', success: 0, failed: results.length, results }
  }

  const results: ProviderDraftResult[] = []
  for (const command of args.commands) {
    const payload = buildPurchasePayload(command, expenseAccountId)
    const res = await fetch(`${QBO_BASE}/${session.realmId}/purchase`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ Purchase: payload }),
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => ({}))) as { Purchase?: { Id?: string } }
    const remoteId = body.Purchase?.Id ?? null
    results.push({
      provider: 'quickbooks',
      transaction_id: command.transaction.transaction_id,
      ok: res.ok,
      status: res.status,
      remote_id: remoteId,
      diagnostic_code: res.ok ? 'QBO_PURCHASE_CREATED' : 'QBO_POST_FAILED',
      message: res.ok ? 'QuickBooksへ送信しました。' : `QuickBooks送信失敗: ${res.status}`,
      next_action: res.ok ? 'Review in QuickBooks.' : 'Check QuickBooks setup and retry.',
      contact: definition.support.url,
    })
  }
  const success = results.filter((r) => r.ok).length
  return {
    ok: success === results.length,
    status: success === results.length ? 200 : 207,
    diagnostic_code: success === results.length ? 'QBO_DRAFT_POSTED' : 'QBO_PARTIAL_FAILURE',
    success,
    failed: results.length - success,
    results,
  }
}

export async function fetchQuickBooksReviewQueue(args: {
  cookieStore: ReadonlyRequestCookies
}): Promise<{
  ok: boolean
  status: number
  diagnostic_code: string
  queue: ReviewQueueItem[]
}> {
  const definition = getProviderDefinition('quickbooks')
  const session = readQuickBooksSession(args.cookieStore)

  if (!session.accessToken || !session.realmId) {
    return {
      ok: false,
      status: 401,
      diagnostic_code: 'QBO_NOT_CONNECTED',
      queue: [],
    }
  }

  return {
    ok: true,
    status: 200,
    diagnostic_code: 'QBO_QUEUE_PLANNED',
    queue: [],
  }
}
