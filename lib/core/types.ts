export type SourceType =
  | 'paper_ocr'
  | 'manual'
  | 'connector_api'
  | 'bank_feed'
  | 'card_feed'

export type Direction = 'income' | 'expense'
export type DecisionRank = 'OK' | 'REVIEW' | 'NG'

export interface CanonicalTransaction {
  transaction_id: string
  source_type: SourceType
  direction: Direction
  occurred_at: string // YYYY-MM-DD
  amount: number
  currency: string
  counterparty?: string
  memo_redacted: string
  country_code: string
  raw_reference?: string
}

export interface ClassificationDecision {
  decision_id: string
  transaction_id: string
  rank: DecisionRank
  is_expense: boolean
  allocation_rate: number // 0..1
  category: string
  amount: number
  date: string // YYYY-MM-DD
  reason: string
  confidence: number // 0..1
  country_code: string
  rule_version: string
  model_version: string
  support_code?: string
}

export interface PostingCommand {
  transaction: CanonicalTransaction
  decision: ClassificationDecision
}

export interface PostingResult {
  transaction_id: string
  ok: boolean
  status: number
  freee_deal_id?: number | null
  freee_request_id?: string | null
  diagnostic_code: string
  message: string
}

export interface AuditMeta {
  event_id: string
  event_type: string
  actor_user_id: string
  transaction_id?: string
  decision_id?: string
  status: 'success' | 'error'
  diagnostic_code?: string
  rule_version?: string
  model_version?: string
  created_at: string
}
