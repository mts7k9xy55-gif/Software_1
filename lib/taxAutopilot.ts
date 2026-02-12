export type ExpenseRank = 'OK' | 'REVIEW' | 'NG'

export interface ExpenseInput {
  id: string
  expense_date: string
  amount: number
  description: string
  receipt_url: string | null
}

export interface ClassifiedExpense {
  expenseId: string
  rank: ExpenseRank
  confidence: number
  reason: string
  accountItem: string
  taxCategory: '課税仕入' | '不課税/対象外'
  businessRatio: number
  hasReceipt: boolean
  needsReceipt: boolean
  provider?: string
  model?: string
}

export interface ClassificationSummary {
  total: number
  okCount: number
  reviewCount: number
  ngCount: number
  missingReceiptCount: number
  maxReviewAllowed: number
  exportBlocked: boolean
}

function includesAny(target: string, keywords: string[]): boolean {
  return keywords.some((word) => target.includes(word))
}

function roundConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function classifyExpense(expense: ExpenseInput): ClassifiedExpense {
  const text = `${expense.description}`.toLowerCase()
  const hasReceipt = Boolean(expense.receipt_url)

  let score = 50
  let rank: ExpenseRank = 'REVIEW'
  let reason = '情報不足のため確認が必要です。'
  let accountItem = '雑費'
  let businessRatio = 100
  let taxCategory: '課税仕入' | '不課税/対象外' = '課税仕入'
  let needsReceipt = expense.amount >= 5000

  if (includesAny(text, ['amazon', 'アマゾン', '資材', '消耗品', '備品', '包装', '梱包'])) {
    score += 30
    rank = 'OK'
    reason = '事業用資材・消耗品の可能性が高い支出です。'
    accountItem = '消耗品費'
  }

  if (includesAny(text, ['送料', '運賃', '配送', 'ゆうパック', 'ヤマト', '佐川'])) {
    score += 30
    rank = 'OK'
    reason = '配送関連費用として整合しています。'
    accountItem = '荷造運賃'
  }

  if (includesAny(text, ['サーバー', 'ドメイン', 'hosting', 'aws', 'gcp', 'vercel', 'github'])) {
    score += 35
    rank = 'OK'
    reason = 'サービス運営に必要なシステム費用です。'
    accountItem = '通信費'
  }

  if (includesAny(text, ['家賃', '水道', '電気', 'ガス', '携帯'])) {
    score -= 5
    rank = 'REVIEW'
    reason = '家事按分の確認が必要な支出です。'
    businessRatio = 50
    accountItem = '地代家賃'
    needsReceipt = true
  }

  if (includesAny(text, ['飲み会', '娯楽', 'ゲーム', 'プレゼント', '私用', '個人'])) {
    score = 10
    rank = 'NG'
    reason = '私的支出の可能性が高く、経費計上は非推奨です。'
    businessRatio = 0
    accountItem = '対象外'
    taxCategory = '不課税/対象外'
    needsReceipt = false
  }

  if (expense.amount > 150000) {
    rank = rank === 'NG' ? 'NG' : 'REVIEW'
    score -= 20
    reason = '高額支出のため固定資産/減価償却の確認が必要です。'
    accountItem = '工具器具備品'
    needsReceipt = true
  }

  if (needsReceipt && !hasReceipt) {
    if (rank === 'OK') rank = 'REVIEW'
    score -= 15
    reason = '証憑が未登録のため確認が必要です。'
  }

  return {
    expenseId: expense.id,
    rank,
    confidence: roundConfidence(score),
    reason,
    accountItem,
    taxCategory,
    businessRatio,
    hasReceipt,
    needsReceipt,
  }
}

export function classifyExpenses(expenses: ExpenseInput[]): ClassifiedExpense[] {
  return expenses.map((expense) => classifyExpense(expense))
}

export function summarizeClassifiedExpenses(
  items: ClassifiedExpense[],
  reviewThresholdRatio = 0.1
): ClassificationSummary {
  const okCount = items.filter((item) => item.rank === 'OK').length
  const reviewCount = items.filter((item) => item.rank === 'REVIEW').length
  const ngCount = items.filter((item) => item.rank === 'NG').length
  const missingReceiptCount = items.filter((item) => item.needsReceipt && !item.hasReceipt).length

  const total = items.length
  const maxReviewAllowed = Math.max(1, Math.ceil(total * reviewThresholdRatio))
  const tooManyReviews = reviewCount > maxReviewAllowed

  return {
    total,
    okCount,
    reviewCount,
    ngCount,
    missingReceiptCount,
    maxReviewAllowed,
    exportBlocked: ngCount > 0 || tooManyReviews,
  }
}
