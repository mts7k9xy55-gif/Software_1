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

const XERO_API = 'https://api.xero.com/api.xro/2.0'

async function fetchXeroAccounts(accessToken: string, tenantId: string): Promise<{
  bankAccountId: string | null
  expenseAccountCode: string | null
}> {
  const res = await fetch(`${XERO_API}/Accounts`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
    },
    cache: 'no-store',
  })
  if (!res.ok) return { bankAccountId: null, expenseAccountCode: null }
  const json = (await res.json()) as { Accounts?: Array<{ AccountID?: string; Code?: string; Type?: string }> }
  const accounts = json.Accounts ?? []
  const bank = accounts.find((a) => a.Type === 'BANK')
  const expense = accounts.find((a) => a.Type === 'EXPENSE')
  return {
    bankAccountId: bank?.AccountID ?? null,
    expenseAccountCode: expense?.Code ?? '200',
  }
}

async function fetchXeroDefaultContact(accessToken: string, tenantId: string): Promise<string | null> {
  const res = await fetch(`${XERO_API}/Contacts?page=1&pageSize=1`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
    },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const json = (await res.json()) as { Contacts?: Array<{ ContactID?: string }> }
  return json.Contacts?.[0]?.ContactID ?? null
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

  const { bankAccountId, expenseAccountCode } = await fetchXeroAccounts(session.accessToken, session.tenantId)
  if (!bankAccountId) {
    const results: ProviderDraftResult[] = args.commands.map((command) => ({
      provider: 'xero',
      transaction_id: command.transaction.transaction_id,
      ok: false,
      status: 400,
      diagnostic_code: 'XERO_BANK_ACCOUNT_NOT_FOUND',
      message: 'Xeroに銀行口座がありません。',
      next_action: 'Add a bank account in Xero and retry.',
      contact: definition.support.url,
    }))
    return { ok: false, status: 400, diagnostic_code: 'XERO_BANK_ACCOUNT_NOT_FOUND', success: 0, failed: results.length, results }
  }

  const contactId = await fetchXeroDefaultContact(session.accessToken, session.tenantId)
  if (!contactId) {
    const results: ProviderDraftResult[] = args.commands.map((command) => ({
      provider: 'xero',
      transaction_id: command.transaction.transaction_id,
      ok: false,
      status: 400,
      diagnostic_code: 'XERO_CONTACT_NOT_FOUND',
      message: 'Xeroに取引先がありません。',
      next_action: 'Add a supplier contact in Xero and retry.',
      contact: definition.support.url,
    }))
    return { ok: false, status: 400, diagnostic_code: 'XERO_CONTACT_NOT_FOUND', success: 0, failed: results.length, results }
  }

  const results: ProviderDraftResult[] = []
  for (const command of args.commands) {
    const amount = Math.max(0.01, (command.transaction.amount * command.decision.allocation_rate) / 1)
    const desc = `[Tax man] ${command.transaction.memo_redacted}`.slice(0, 100)
    const payload = {
      Type: 'SPEND',
      Contact: { ContactID: contactId },
      BankAccount: { AccountID: bankAccountId },
      LineAmountTypes: 'Exclusive',
      LineItems: [
        {
          Description: desc,
          UnitAmount: amount.toFixed(2),
          TaxType: 'NONE',
          AccountCode: expenseAccountCode,
        },
      ],
    }
    const res = await fetch(`${XERO_API}/BankTransactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Xero-Tenant-Id': session.tenantId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => ({}))) as { BankTransactions?: Array<{ BankTransactionID?: string }> }
    const remoteId = body.BankTransactions?.[0]?.BankTransactionID ?? null
    results.push({
      provider: 'xero',
      transaction_id: command.transaction.transaction_id,
      ok: res.ok,
      status: res.status,
      remote_id: remoteId,
      diagnostic_code: res.ok ? 'XERO_BANK_TX_CREATED' : 'XERO_POST_FAILED',
      message: res.ok ? 'Xeroへ送信しました。' : `Xero送信失敗: ${res.status}`,
      next_action: res.ok ? 'Review in Xero.' : 'Check Xero setup and retry.',
      contact: definition.support.url,
    })
  }
  const success = results.filter((r) => r.ok).length
  return {
    ok: success === results.length,
    status: success === results.length ? 200 : 207,
    diagnostic_code: success === results.length ? 'XERO_DRAFT_POSTED' : 'XERO_PARTIAL_FAILURE',
    success,
    failed: results.length - success,
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
    ok: true,
    status: 200,
    diagnostic_code: 'XERO_QUEUE_PLANNED',
    queue: [],
  }
}
