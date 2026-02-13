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

function makeNotImplementedResults(commands: PostingCommand[]): ProviderDraftResult[] {
  const definition = getProviderDefinition('quickbooks')
  return commands.map((command) => ({
    provider: 'quickbooks',
    transaction_id: command.transaction.transaction_id,
    ok: false,
    status: 501,
    diagnostic_code: 'QBO_POSTING_NOT_IMPLEMENTED',
    message: 'QuickBooksへの下書き送信は現在準備中です。',
    next_action: 'Enable QuickBooks posting endpoint or use CSV export fallback.',
    contact: definition.support.url,
  }))
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

  const results = makeNotImplementedResults(args.commands)
  return {
    ok: false,
    status: 501,
    diagnostic_code: 'QBO_POSTING_NOT_IMPLEMENTED',
    success: 0,
    failed: results.length,
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
    ok: false,
    status: 501,
    diagnostic_code: 'QBO_QUEUE_NOT_IMPLEMENTED',
    queue: [
      {
        provider: 'quickbooks',
        id: null,
        issue_date: '',
        amount: 0,
        status: 'not_implemented',
        memo: 'QuickBooks queue retrieval is not implemented yet.',
        next_action: 'Use provider UI directly or enable connector implementation.',
        contact: definition.support.url,
      },
    ],
  }
}
