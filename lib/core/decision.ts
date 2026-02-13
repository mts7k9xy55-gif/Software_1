import { classifyExpense, type ExpenseInput } from '@/lib/taxAutopilot'
import { getJurisdictionProfile } from './jurisdiction'
import type { CanonicalTransaction, ClassificationDecision, DecisionRank } from './types'

interface LlmDecisionCandidate {
  is_expense?: boolean
  allocation_rate?: number
  category?: string
  amount?: number
  date?: string
  reason?: string
  confidence?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{2,4}-\d{2,4}-\d{3,4}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{12,19}\b/g, '[REDACTED_NUMBER]')
    .replace(/\d{7,}/g, '[REDACTED_DIGITS]')
    .trim()
    .slice(0, 200)
}

function normalizeDate(input: string): string {
  const clean = String(input).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean
  const d = new Date(clean)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function toRuleBasedDecision(transaction: CanonicalTransaction): ClassificationDecision {
  const expense: ExpenseInput = {
    id: transaction.transaction_id,
    expense_date: transaction.occurred_at,
    amount: transaction.amount,
    description: transaction.memo_redacted,
    receipt_url: transaction.source_type === 'paper_ocr' ? 'paper://receipt' : null,
  }

  const classified = classifyExpense(expense)
  const isExpense = classified.rank !== 'NG'
  const allocation = clamp(classified.businessRatio / 100, 0, 1)
  const confidence = clamp(classified.confidence / 100, 0, 1)

  return {
    decision_id: crypto.randomUUID(),
    transaction_id: transaction.transaction_id,
    rank: classified.rank,
    is_expense: isExpense,
    allocation_rate: allocation,
    category: classified.accountItem,
    amount: transaction.amount,
    date: normalizeDate(transaction.occurred_at),
    reason: classified.reason,
    confidence,
    country_code: transaction.country_code,
    rule_version: getJurisdictionProfile(transaction.country_code).ruleVersion,
    model_version: 'rule-only-v1',
  }
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

async function callGeminiForDecision(
  transaction: CanonicalTransaction,
  ruleDecision: ClassificationDecision
): Promise<LlmDecisionCandidate | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  if ((process.env.ENABLE_EXTERNAL_LLM ?? '0') !== '1') return null

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite'
  const profile = getJurisdictionProfile(transaction.country_code)

  const prompt = [
    '以下の収支情報を分析し、必要経費か判断してください。',
    `Jurisdiction: ${profile.countryCode}`,
    `Rule hint: ${profile.promptHint}`,
    'JSONのみ出力:',
    '{"is_expense":true,"allocation_rate":1,"category":"消耗品費","amount":1200,"date":"2026-02-14","reason":"業務利用","confidence":0.82}',
    'Input JSON:',
    JSON.stringify({
      amount: transaction.amount,
      date: transaction.occurred_at,
      memo: transaction.memo_redacted,
      source: transaction.source_type,
      direction: transaction.direction,
      ruleDecision,
    }),
  ].join('\n')

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    }
  )

  if (!response.ok) return null
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const parsed = safeParseJson(text)
  if (!parsed) return null

  return {
    is_expense: Boolean(parsed.is_expense),
    allocation_rate: Number(parsed.allocation_rate),
    category: String(parsed.category ?? ''),
    amount: Number(parsed.amount),
    date: String(parsed.date ?? ''),
    reason: String(parsed.reason ?? ''),
    confidence: Number(parsed.confidence),
  }
}

function mergeWithConfidenceGate(
  transaction: CanonicalTransaction,
  ruleDecision: ClassificationDecision,
  llm: LlmDecisionCandidate | null
): ClassificationDecision {
  const profile = getJurisdictionProfile(transaction.country_code)
  if (!llm) return ruleDecision

  const confidence = clamp(Number.isFinite(llm.confidence) ? Number(llm.confidence) : ruleDecision.confidence, 0, 1)
  const isExpense = Boolean(llm.is_expense)
  const allocationRate = clamp(
    Number.isFinite(llm.allocation_rate) ? Number(llm.allocation_rate) : ruleDecision.allocation_rate,
    0,
    profile.maxAllocationRate
  )

  let rank: DecisionRank = 'REVIEW'
  if (!isExpense) rank = 'NG'
  else if (confidence >= profile.reviewConfidenceThreshold) rank = 'OK'

  return {
    ...ruleDecision,
    rank,
    is_expense: isExpense,
    allocation_rate: allocationRate,
    category: String(llm.category || ruleDecision.category || '雑費').slice(0, 80),
    amount:
      Number.isFinite(llm.amount) && Number(llm.amount) > 0
        ? Math.floor(Number(llm.amount))
        : ruleDecision.amount,
    date: normalizeDate(llm.date || ruleDecision.date),
    reason: String(llm.reason || ruleDecision.reason || 'Additional verification required').slice(0, 240),
    confidence,
    model_version: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite',
  }
}

export async function evaluateTransaction(
  transaction: CanonicalTransaction
): Promise<ClassificationDecision> {
  const safeTx: CanonicalTransaction = {
    ...transaction,
    occurred_at: normalizeDate(transaction.occurred_at),
    amount: Math.max(1, Math.floor(Number(transaction.amount) || 0)),
    memo_redacted: redactSensitiveText(transaction.memo_redacted),
  }

  const ruleDecision = toRuleBasedDecision(safeTx)
  if (ruleDecision.rank !== 'REVIEW') return ruleDecision

  const llm = await callGeminiForDecision(safeTx, ruleDecision)
  return mergeWithConfidenceGate(safeTx, ruleDecision, llm)
}
