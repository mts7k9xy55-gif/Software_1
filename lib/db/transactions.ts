import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import type {
  CanonicalTransaction,
  ClassificationDecision,
  PostingCommand,
  PostingResult,
  TenantContext,
} from '@/lib/core/types'

export async function persistTransaction(
  tenant: TenantContext,
  transaction: CanonicalTransaction,
  decision: ClassificationDecision
): Promise<void> {
  const supabase = getSupabaseAdmin()

  const { error: txError } = await supabase.from('filing_transactions').insert({
    transaction_id: transaction.transaction_id,
    organization_id: tenant.organization_id,
    user_id: tenant.user_id,
    source_type: transaction.source_type,
    direction: transaction.direction,
    occurred_at: transaction.occurred_at,
    amount: transaction.amount,
    currency: transaction.currency,
    counterparty: transaction.counterparty ?? null,
    memo_redacted: transaction.memo_redacted,
    country_code: transaction.country_code,
    raw_reference: transaction.raw_reference ?? null,
  })

  if (txError) throw txError

  const { error: decError } = await supabase.from('filing_decisions').insert({
    transaction_id: transaction.transaction_id,
    organization_id: tenant.organization_id,
    decision_id: decision.decision_id,
    rank: decision.rank,
    is_expense: decision.is_expense,
    allocation_rate: decision.allocation_rate,
    category: decision.category,
    amount: decision.amount,
    date: decision.date,
    reason: decision.reason,
    confidence: decision.confidence,
    country_code: decision.country_code,
    rule_version: decision.rule_version,
    model_version: decision.model_version,
    support_code: decision.support_code ?? null,
  })

  if (decError) throw decError
}

export async function listTransactions(
  tenant: TenantContext,
  options?: { limit?: number; offset?: number }
): Promise<Array<{ transaction: CanonicalTransaction; decision: ClassificationDecision; posted?: PostingResult }>> {
  const supabase = getSupabaseAdmin()
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500)
  const offset = Math.max(options?.offset ?? 0, 0)

  const { data: rows, error } = await supabase
    .from('filing_transactions')
    .select('*')
    .eq('organization_id', tenant.organization_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw error
  if (!rows?.length) return []

  const txIds = rows.map((r) => r.transaction_id)
  const { data: decisions } = await supabase
    .from('filing_decisions')
    .select('*')
    .eq('organization_id', tenant.organization_id)
    .in('transaction_id', txIds)

  const decisionMap = new Map((decisions ?? []).map((d) => [d.transaction_id, d]))

  function toDateStr(v: unknown): string {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    return String(v ?? '').slice(0, 10)
  }

  return rows.map((row) => {
    const dec = decisionMap.get(row.transaction_id)
    const transaction: CanonicalTransaction = {
      transaction_id: row.transaction_id,
      source_type: row.source_type,
      direction: row.direction,
      occurred_at: toDateStr(row.occurred_at),
      amount: row.amount,
      currency: row.currency,
      counterparty: row.counterparty ?? undefined,
      memo_redacted: row.memo_redacted ?? '',
      country_code: row.country_code,
      raw_reference: row.raw_reference ?? undefined,
    }
    const decision: ClassificationDecision = dec
      ? {
          decision_id: dec.decision_id,
          transaction_id: dec.transaction_id,
          rank: dec.rank,
          is_expense: dec.is_expense,
          allocation_rate: dec.allocation_rate,
          category: dec.category,
          amount: dec.amount,
          date: toDateStr(dec.date),
          reason: dec.reason,
          confidence: dec.confidence,
          country_code: dec.country_code,
          rule_version: dec.rule_version,
          model_version: dec.model_version,
          support_code: dec.support_code ?? undefined,
        }
      : {
          decision_id: '',
          transaction_id: row.transaction_id,
          rank: 'REVIEW',
          is_expense: true,
          allocation_rate: 1,
          category: '未分類',
          amount: row.amount,
          date: row.occurred_at,
          reason: 'No decision stored',
          confidence: 0,
          country_code: row.country_code,
          rule_version: '',
          model_version: '',
        }

    const posted: PostingResult | undefined =
      row.posted_provider && row.posted_remote_id
        ? {
            provider: row.posted_provider as PostingResult['provider'],
            transaction_id: row.transaction_id,
            ok: true,
            status: 200,
            remote_id: row.posted_remote_id,
            diagnostic_code: 'POSTED',
            message: 'Posted',
          }
        : undefined

    return { transaction, decision, posted }
  })
}

export async function getPostableTransactions(
  tenant: TenantContext,
  minConfidence: number
): Promise<PostingCommand[]> {
  const supabase = getSupabaseAdmin()
  const { data: rows, error } = await supabase
    .from('filing_transactions')
    .select('*')
    .eq('organization_id', tenant.organization_id)
    .is('posted_provider', null)
    .order('created_at', { ascending: true })

  if (error) throw error
  if (!rows?.length) return []

  const txIds = rows.map((r) => r.transaction_id)
  const { data: decisions } = await supabase
    .from('filing_decisions')
    .select('*')
    .eq('organization_id', tenant.organization_id)
    .in('transaction_id', txIds)
    .eq('rank', 'OK')
    .eq('is_expense', true)
    .gte('confidence', minConfidence)

  const decisionMap = new Map((decisions ?? []).map((d) => [d.transaction_id, d]))

  function toDateStr(v: unknown): string {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    return String(v ?? '').slice(0, 10)
  }

  const commands: PostingCommand[] = []
  for (const row of rows) {
    const dec = decisionMap.get(row.transaction_id)
    if (!dec) continue
    commands.push({
      transaction: {
        transaction_id: row.transaction_id,
        source_type: row.source_type,
        direction: row.direction,
        occurred_at: toDateStr(row.occurred_at),
        amount: row.amount,
        currency: row.currency,
        counterparty: row.counterparty ?? undefined,
        memo_redacted: row.memo_redacted ?? '',
        country_code: row.country_code,
        raw_reference: row.raw_reference ?? undefined,
      },
      decision: {
        decision_id: dec.decision_id,
        transaction_id: dec.transaction_id,
        rank: dec.rank,
        is_expense: dec.is_expense,
        allocation_rate: dec.allocation_rate,
        category: dec.category,
        amount: dec.amount,
        date: toDateStr(dec.date),
        reason: dec.reason,
        confidence: dec.confidence,
        country_code: dec.country_code,
        rule_version: dec.rule_version,
        model_version: dec.model_version,
        support_code: dec.support_code ?? undefined,
      },
    })
  }
  return commands
}

export async function updatePostingResult(
  tenant: TenantContext,
  transactionId: string,
  result: PostingResult
): Promise<void> {
  if (!result.ok) return
  const supabase = getSupabaseAdmin()
  const remoteId = result.remote_id ?? result.freee_deal_id ?? null
  if (remoteId == null) return

  await supabase
    .from('filing_transactions')
    .update({
      posted_provider: result.provider ?? undefined,
      posted_remote_id: String(remoteId),
      posted_at: new Date().toISOString(),
    })
    .eq('organization_id', tenant.organization_id)
    .eq('transaction_id', transactionId)
}
