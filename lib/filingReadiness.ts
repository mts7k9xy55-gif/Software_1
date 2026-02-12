import type { ClassifiedExpense, ClassificationSummary } from '@/lib/taxAutopilot'

export type FilingItemStatus = 'READY' | 'REVIEW' | 'BLOCKER'
export type FilingReadinessStatus = 'READY' | 'REVIEW_REQUIRED' | 'BLOCKED'

export interface FilingReadinessInput {
  startDate: string
  endDate: string
  salesCount: number
  salesGross: number
  expenseCount: number
  expenseTotal: number
  inventoryAmount: number
  classificationSummary: ClassificationSummary
  classifiedExpenses: ClassifiedExpense[]
}

export interface FilingReadinessItem {
  id: string
  title: string
  status: FilingItemStatus
  reason: string
  action: string
}

export interface FilingReadiness {
  status: FilingReadinessStatus
  score: number
  exportBlocked: boolean
  blockers: string[]
  items: FilingReadinessItem[]
}

function createItem(
  id: string,
  title: string,
  status: FilingItemStatus,
  reason: string,
  action: string
): FilingReadinessItem {
  return { id, title, status, reason, action }
}

function scoreByStatus(status: FilingItemStatus): number {
  if (status === 'READY') return 1
  if (status === 'REVIEW') return 0.6
  return 0
}

function toPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function buildFilingReadiness(input: FilingReadinessInput): FilingReadiness {
  const items: FilingReadinessItem[] = []

  if (input.salesCount > 0) {
    items.push(
      createItem(
        'sales-capture',
        '売上データ',
        'READY',
        `${input.salesCount}件の売上を集計済みです。`,
        'このまま進めてください。'
      )
    )
  } else {
    items.push(
      createItem(
        'sales-capture',
        '売上データ',
        'BLOCKER',
        `期間 ${input.startDate}〜${input.endDate} の売上が0件です。`,
        '期間設定かPOS連携の状態を確認し、再集計してください。'
      )
    )
  }

  if (input.expenseCount > 0) {
    items.push(
      createItem(
        'expense-capture',
        '経費データ',
        'READY',
        `${input.expenseCount}件（合計 ${input.expenseTotal.toLocaleString('ja-JP')}円）を取得済みです。`,
        '証憑不足がある場合のみ確認してください。'
      )
    )
  } else {
    items.push(
      createItem(
        'expense-capture',
        '経費データ',
        'REVIEW',
        '期間内の経費が0件です（実際に0件なら問題ありません）。',
        '税理士に「経費0件」を明示し、必要なら追加してください。'
      )
    )
  }

  if (input.classificationSummary.ngCount > 0) {
    items.push(
      createItem(
        'expense-ng',
        '経費NG判定',
        'BLOCKER',
        `${input.classificationSummary.ngCount}件がNG判定です。`,
        '私費混在の可能性が高い項目を除外または修正してください。'
      )
    )
  } else {
    items.push(
      createItem('expense-ng', '経費NG判定', 'READY', 'NG判定はありません。', 'このまま進めてください。')
    )
  }

  if (input.classificationSummary.reviewCount > input.classificationSummary.maxReviewAllowed) {
    items.push(
      createItem(
        'expense-review-cap',
        '要確認件数',
        'BLOCKER',
        `要確認 ${input.classificationSummary.reviewCount}件（許容 ${input.classificationSummary.maxReviewAllowed}件）です。`,
        '内容や証憑を補って要確認件数を下げてください。'
      )
    )
  } else if (input.classificationSummary.reviewCount > 0) {
    items.push(
      createItem(
        'expense-review-cap',
        '要確認件数',
        'REVIEW',
        `要確認は ${input.classificationSummary.reviewCount}件です。`,
        '税理士チェック時に理由欄と証憑を一緒に確認してください。'
      )
    )
  } else {
    items.push(
      createItem(
        'expense-review-cap',
        '要確認件数',
        'READY',
        '要確認はありません。',
        'このまま進めてください。'
      )
    )
  }

  if (input.classificationSummary.missingReceiptCount > 0) {
    items.push(
      createItem(
        'missing-receipts',
        '証憑不足',
        'REVIEW',
        `${input.classificationSummary.missingReceiptCount}件で証憑不足の可能性があります。`,
        'レシート/請求書/明細URLを追加しておくと最終確認が速くなります。'
      )
    )
  } else {
    items.push(
      createItem('missing-receipts', '証憑不足', 'READY', '証憑不足は検出されませんでした。', 'このまま進めてください。')
    )
  }

  const highAmountCount = input.classifiedExpenses.filter((item) => item.accountItem === '工具器具備品').length
  if (highAmountCount > 0) {
    items.push(
      createItem(
        'fixed-assets',
        '固定資産・減価償却',
        'REVIEW',
        `${highAmountCount}件で固定資産判定の可能性があります。`,
        '税理士に耐用年数の確認を依頼してください。'
      )
    )
  } else {
    items.push(
      createItem(
        'fixed-assets',
        '固定資産・減価償却',
        'READY',
        '高額資産の確認対象は見つかりませんでした。',
        'このまま進めてください。'
      )
    )
  }

  if (input.inventoryAmount > 0) {
    items.push(
      createItem(
        'inventory',
        '在庫情報',
        'READY',
        `在庫調整額 ${input.inventoryAmount.toLocaleString('ja-JP')}円を反映済みです。`,
        'このまま進めてください。'
      )
    )
  } else {
    items.push(
      createItem(
        'inventory',
        '在庫情報',
        'REVIEW',
        '在庫調整額が0円です（無在庫業態なら問題ありません）。',
        '在庫を持つ業態なら期末在庫額を入力してください。'
      )
    )
  }

  // 人件費は未実装のため常に確認事項として残す。
  items.push(
    createItem(
      'payroll',
      '人件費・給与台帳',
      'REVIEW',
      '給与データの自動連携は未実装です。',
      '従業員がいる場合は給与台帳を税理士へ別添してください。'
    )
  )

  const blockers = items.filter((item) => item.status === 'BLOCKER').map((item) => item.title)
  const score = toPercent((items.reduce((sum, item) => sum + scoreByStatus(item.status), 0) / items.length) * 100)
  const status: FilingReadinessStatus = blockers.length > 0 ? 'BLOCKED' : score === 100 ? 'READY' : 'REVIEW_REQUIRED'

  return {
    status,
    score,
    exportBlocked: blockers.length > 0,
    blockers,
    items,
  }
}
