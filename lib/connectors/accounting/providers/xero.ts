import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

import { getProviderDefinition } from '@/lib/connectors/accounting/catalog'
import type {
  PostingCommand,
  ProviderDraftResult,
  ReviewQueueItem,
} from '@/lib/core/types'

interface XeroSession {
  accessToken: string
  refreshToken: string
  tenantId: string
  sharedMode: boolean
}

export interface XeroProviderStatus {
  provider: 'xero'
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

function readXeroSession(cookieStore: ReadonlyRequestCookies): XeroSession {
  const cookieAccess = cookieStore.get('xero_access_token')?.value ?? ''
  const cookieRefresh = cookieStore.get('xero_refresh_token')?.value ?? ''
  const cookieTenant = cookieStore.get('xero_tenant_id')?.value ?? ''

  const sharedMode = (process.env.XERO_SHARED_MODE ?? '0') === '1'
  const sharedAccess = process.env.XERO_SHARED_ACCESS_TOKEN ?? ''
  const sharedRefresh = process.env.XERO_SHARED_REFRESH_TOKEN ?? ''
  const sharedTenant = process.env.XERO_SHARED_TENANT_ID ?? ''

  return {
    accessToken: cookieAccess || (sharedMode ? sharedAccess : ''),
    refreshToken: cookieRefresh || (sharedMode ? sharedRefresh : ''),
    tenantId: cookieTenant || (sharedMode ? sharedTenant : ''),
    sharedMode,
  }
}

function makeNotImplementedResults(commands: PostingCommand[]): ProviderDraftResult[] {
  const definition = getProviderDefinition('xero')
  return commands.map((command) => ({
    provider: 'xero',
    transaction_id: command.transaction.transaction_id,
    ok: false,
    status: 501,
    diagnostic_code: 'XERO_POSTING_NOT_IMPLEMENTED',
    message: 'Xeroへの下書き送信は現在準備中です。',
    next_action: 'Enable Xero posting endpoint or use CSV export fallback.',
    contact: definition.support.url,
  }))
}

export function getXeroStatus(cookieStore: ReadonlyRequestCookies): XeroProviderStatus {
  const definition = getProviderDefinition('xero')
  const session = readXeroSession(cookieStore)
  const configured = Boolean(
    process.env.XERO_CLIENT_ID &&
      process.env.XERO_CLIENT_SECRET &&
      process.env.XERO_REDIRECT_URI
  )

  return {
    provider: 'xero',
    label: definition.label,
    configured,
    connected: Boolean(session.accessToken && session.tenantId),
    mode: session.sharedMode ? 'shared_token' : 'oauth_per_user',
    account_context: session.tenantId || null,
    next_action: session.accessToken && session.tenantId ? 'connected' : 'start_oauth',
    contact: definition.support.url,
    support_name: definition.support.name,
    docs_url: definition.docsUrl,
  }
}

export async function postXeroDrafts(args: {
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
  const session = readXeroSession(args.cookieStore)
  const definition = getProviderDefinition('xero')

  if (!session.accessToken || !session.tenantId) {
    const results: ProviderDraftResult[] = args.commands.map((command) => ({
      provider: 'xero',
      transaction_id: command.transaction.transaction_id,
      ok: false,
      status: 401,
      diagnostic_code: 'XERO_NOT_CONNECTED',
      message: 'Xero未接続です。',
      next_action: 'Connect Xero OAuth and retry.',
      contact: definition.support.url,
    }))

    return {
      ok: false,
      status: 401,
      diagnostic_code: 'XERO_NOT_CONNECTED',
      success: 0,
      failed: results.length,
      results,
    }
  }

  const results = makeNotImplementedResults(args.commands)
  return {
    ok: false,
    status: 501,
    diagnostic_code: 'XERO_POSTING_NOT_IMPLEMENTED',
    success: 0,
    failed: results.length,
    results,
  }
}

export async function fetchXeroReviewQueue(args: {
  cookieStore: ReadonlyRequestCookies
}): Promise<{
  ok: boolean
  status: number
  diagnostic_code: string
  queue: ReviewQueueItem[]
}> {
  const definition = getProviderDefinition('xero')
  const session = readXeroSession(args.cookieStore)

  if (!session.accessToken || !session.tenantId) {
    return {
      ok: false,
      status: 401,
      diagnostic_code: 'XERO_NOT_CONNECTED',
      queue: [],
    }
  }

  return {
    ok: false,
    status: 501,
    diagnostic_code: 'XERO_QUEUE_NOT_IMPLEMENTED',
    queue: [
      {
        provider: 'xero',
        id: null,
        issue_date: '',
        amount: 0,
        status: 'not_implemented',
        memo: 'Xero queue retrieval is not implemented yet.',
        next_action: 'Use provider UI directly or enable connector implementation.',
        contact: definition.support.url,
      },
    ],
  }
}
