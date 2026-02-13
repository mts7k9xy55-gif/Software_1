import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

import { getProviderDefinition, resolveProviderByRegion } from './catalog'
import {
  fetchFreeeReviewQueue,
  getFreeeStatus,
  postFreeeDrafts,
  type FreeePostResult,
  type FreeeReviewResult,
  type FreeeProviderStatus,
} from './providers/freee'
import {
  fetchQuickBooksReviewQueue,
  getQuickBooksStatus,
  postQuickBooksDrafts,
  type QuickBooksProviderStatus,
} from './providers/quickbooks'
import {
  fetchXeroReviewQueue,
  getXeroStatus,
  postXeroDrafts,
  type XeroProviderStatus,
} from './providers/xero'
import type {
  AccountingProvider,
  PostingCommand,
  ProviderDraftResult,
  ReviewQueueItem,
  TenantContext,
} from '@/lib/core/types'

export type ConnectorProviderStatus =
  | FreeeProviderStatus
  | QuickBooksProviderStatus
  | XeroProviderStatus

export interface RoutingResult {
  provider: AccountingProvider
  definition: ReturnType<typeof getProviderDefinition>
}

export function resolveProvider(args: {
  regionCode?: string | null
  requestedProvider?: string | null
}): RoutingResult {
  const normalizedRequested = String(args.requestedProvider ?? '').trim().toLowerCase()
  const fromRegion = resolveProviderByRegion(args.regionCode)

  const provider =
    normalizedRequested === 'freee' ||
    normalizedRequested === 'quickbooks' ||
    normalizedRequested === 'xero'
      ? (normalizedRequested as AccountingProvider)
      : fromRegion

  return {
    provider,
    definition: getProviderDefinition(provider),
  }
}

export function getConnectorStatuses(cookieStore: ReadonlyRequestCookies): ConnectorProviderStatus[] {
  return [getFreeeStatus(cookieStore), getQuickBooksStatus(cookieStore), getXeroStatus(cookieStore)]
}

function normalizeFailedResults(
  provider: AccountingProvider,
  commands: PostingCommand[],
  status: number,
  diagnosticCode: string,
  message: string
): ProviderDraftResult[] {
  const contact = getProviderDefinition(provider).support.url
  return commands.map((command) => ({
    provider,
    transaction_id: command.transaction.transaction_id,
    ok: false,
    status,
    diagnostic_code: diagnosticCode,
    message,
    next_action: 'Reconnect provider and retry.',
    contact,
  }))
}

export async function postDraftsByProvider(args: {
  cookieStore: ReadonlyRequestCookies
  provider: AccountingProvider
  commands: PostingCommand[]
  tenant: TenantContext
}): Promise<{
  provider: AccountingProvider
  ok: boolean
  status: number
  diagnostic_code: string
  success: number
  failed: number
  results: ProviderDraftResult[]
  freeeRefresh: FreeePostResult['refreshed'] | null
}> {
  if (args.commands.length === 0) {
    return {
      provider: args.provider,
      ok: false,
      status: 400,
      diagnostic_code: 'NO_COMMANDS',
      success: 0,
      failed: 0,
      results: [],
      freeeRefresh: null,
    }
  }

  if (args.provider === 'freee') {
    const posted = await postFreeeDrafts({
      cookieStore: args.cookieStore,
      commands: args.commands,
      tenant: args.tenant,
    })
    return {
      provider: 'freee',
      ok: posted.ok,
      status: posted.status,
      diagnostic_code: posted.diagnostic_code,
      success: posted.success,
      failed: posted.failed,
      results: posted.results,
      freeeRefresh: posted.refreshed,
    }
  }

  if (args.provider === 'quickbooks') {
    const posted = await postQuickBooksDrafts({
      cookieStore: args.cookieStore,
      commands: args.commands,
    })
    return {
      provider: 'quickbooks',
      ok: posted.ok,
      status: posted.status,
      diagnostic_code: posted.diagnostic_code,
      success: posted.success,
      failed: posted.failed,
      results: posted.results,
      freeeRefresh: null,
    }
  }

  if (args.provider === 'xero') {
    const posted = await postXeroDrafts({
      cookieStore: args.cookieStore,
      commands: args.commands,
    })
    return {
      provider: 'xero',
      ok: posted.ok,
      status: posted.status,
      diagnostic_code: posted.diagnostic_code,
      success: posted.success,
      failed: posted.failed,
      results: posted.results,
      freeeRefresh: null,
    }
  }

  return {
    provider: args.provider,
    ok: false,
    status: 501,
    diagnostic_code: 'PROVIDER_NOT_SUPPORTED',
    success: 0,
    failed: args.commands.length,
    results: normalizeFailedResults(
      args.provider,
      args.commands,
      501,
      'PROVIDER_NOT_SUPPORTED',
      '指定された会計プロバイダはサポート外です。'
    ),
    freeeRefresh: null,
  }
}

export async function fetchReviewQueueByProvider(args: {
  cookieStore: ReadonlyRequestCookies
  provider: AccountingProvider
  limit?: number
}): Promise<{
  provider: AccountingProvider
  ok: boolean
  status: number
  diagnostic_code: string
  queue: ReviewQueueItem[]
  freeeRefresh: FreeeReviewResult['refreshed'] | null
}> {
  if (args.provider === 'freee') {
    const fetched = await fetchFreeeReviewQueue({ cookieStore: args.cookieStore, limit: args.limit })
    return {
      provider: 'freee',
      ok: fetched.ok,
      status: fetched.status,
      diagnostic_code: fetched.diagnostic_code,
      queue: fetched.queue,
      freeeRefresh: fetched.refreshed,
    }
  }

  if (args.provider === 'quickbooks') {
    const fetched = await fetchQuickBooksReviewQueue({ cookieStore: args.cookieStore })
    return {
      provider: 'quickbooks',
      ok: fetched.ok,
      status: fetched.status,
      diagnostic_code: fetched.diagnostic_code,
      queue: fetched.queue,
      freeeRefresh: null,
    }
  }

  if (args.provider === 'xero') {
    const fetched = await fetchXeroReviewQueue({ cookieStore: args.cookieStore })
    return {
      provider: 'xero',
      ok: fetched.ok,
      status: fetched.status,
      diagnostic_code: fetched.diagnostic_code,
      queue: fetched.queue,
      freeeRefresh: null,
    }
  }

  const definition = getProviderDefinition(args.provider)
  return {
    provider: args.provider,
    ok: false,
    status: 501,
    diagnostic_code: 'PROVIDER_NOT_SUPPORTED',
    queue: [
      {
        provider: args.provider,
        id: null,
        issue_date: '',
        amount: 0,
        status: 'unsupported',
        memo: 'Unsupported provider.',
        next_action: 'Select another provider.',
        contact: definition.support.url,
      },
    ],
    freeeRefresh: null,
  }
}
