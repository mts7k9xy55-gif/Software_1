import { supabase } from './supabase'
import {
  SaleItem,
  TaxDetail,
  SalesAggregation,
  TaxBreakdown,
  DailyBreakdown,
  TaxAnalysisReport,
} from '@/types/database'

interface SalesRecord {
  id: number
  items: SaleItem[]
  total_amount: number
  tax_details: TaxDetail[]
  created_at: string
}

/**
 * 期間指定でsalesテーブルからデータを取得
 */
export async function fetchSalesByPeriod(
  startDate: string,
  endDate: string
): Promise<SalesRecord[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Sales取得エラー:', error)
    throw new Error(`Sales取得に失敗しました: ${error.message}`)
  }

  return data || []
}

/**
 * 税率ごとに集計して合計金額を計算
 */
export function aggregateSalesByTaxRate(
  sales: SalesRecord[],
  startDate: string,
  endDate: string
): SalesAggregation {
  const taxMap = new Map<number, TaxBreakdown>()
  const dailyMap = new Map<string, DailyBreakdown>()

  let totalAmount = 0
  let totalTax = 0
  let netAmount = 0

  for (const sale of sales) {
    totalAmount += sale.total_amount

    // 日別集計
    const dateKey = sale.created_at.split('T')[0]
    const dailyEntry = dailyMap.get(dateKey) || {
      date: dateKey,
      total_amount: 0,
      total_tax: 0,
      transaction_count: 0,
    }

    // tax_detailsがある場合はそれを使用
    if (sale.tax_details && sale.tax_details.length > 0) {
      for (const detail of sale.tax_details) {
        const existing = taxMap.get(detail.tax_rate) || {
          tax_rate: detail.tax_rate,
          tax_rate_label: `${(detail.tax_rate * 100).toFixed(0)}%`,
          subtotal: 0,
          tax_amount: 0,
          total: 0,
          transaction_count: 0,
        }

        existing.subtotal += detail.subtotal
        existing.tax_amount += detail.tax_amount
        existing.total += detail.total
        existing.transaction_count += 1

        taxMap.set(detail.tax_rate, existing)

        totalTax += detail.tax_amount
        netAmount += detail.subtotal
        dailyEntry.total_tax += detail.tax_amount
      }
    } else {
      // tax_detailsがない場合、itemsから計算
      for (const item of sale.items) {
        const taxRate = item.tax_rate || 0.10 // デフォルト10%
        const itemTotal = item.price * item.quantity
        const itemNetAmount = itemTotal / (1 + taxRate)
        const itemTax = itemTotal - itemNetAmount

        const existing = taxMap.get(taxRate) || {
          tax_rate: taxRate,
          tax_rate_label: `${(taxRate * 100).toFixed(0)}%`,
          subtotal: 0,
          tax_amount: 0,
          total: 0,
          transaction_count: 0,
        }

        existing.subtotal += itemNetAmount
        existing.tax_amount += itemTax
        existing.total += itemTotal
        taxMap.set(taxRate, existing)

        totalTax += itemTax
        netAmount += itemNetAmount
        dailyEntry.total_tax += itemTax
      }
    }

    dailyEntry.total_amount += sale.total_amount
    dailyEntry.transaction_count += 1
    dailyMap.set(dateKey, dailyEntry)
  }

  // transaction_countの補正（税率ごとではなくsale単位で1つ）
  for (const sale of sales) {
    const taxRatesInSale = new Set<number>()
    if (sale.tax_details && sale.tax_details.length > 0) {
      sale.tax_details.forEach((d) => taxRatesInSale.add(d.tax_rate))
    } else {
      sale.items.forEach((i) => taxRatesInSale.add(i.tax_rate || 0.10))
    }
    // 複数税率がある場合でも、各税率のcountは1ずつのまま
  }

  const taxBreakdown = Array.from(taxMap.values()).sort(
    (a, b) => a.tax_rate - b.tax_rate
  )
  const dailyBreakdown = Array.from(dailyMap.values()).sort(
    (a, b) => a.date.localeCompare(b.date)
  )

  return {
    period: {
      start_date: startDate,
      end_date: endDate,
    },
    summary: {
      total_sales_count: sales.length,
      total_amount: Math.round(totalAmount * 100) / 100,
      total_tax: Math.round(totalTax * 100) / 100,
      net_amount: Math.round(netAmount * 100) / 100,
    },
    tax_breakdown: taxBreakdown,
    daily_breakdown: dailyBreakdown,
  }
}

/**
 * 期間指定でsalesを取得し、税率ごとに集計
 */
export async function getSalesAggregation(
  startDate: string,
  endDate: string
): Promise<SalesAggregation> {
  const sales = await fetchSalesByPeriod(startDate, endDate)
  return aggregateSalesByTaxRate(sales, startDate, endDate)
}

/**
 * LLM向け税務分析レポート用のJSON形式に整形
 */
export function formatForTaxAnalysisReport(
  aggregation: SalesAggregation
): TaxAnalysisReport {
  const { summary, tax_breakdown, daily_breakdown, period } = aggregation

  // 標準税率(10%)と軽減税率(8%)の割合を計算
  const standardRateData = tax_breakdown.find((t) => t.tax_rate === 0.10)
  const reducedRateData = tax_breakdown.find((t) => t.tax_rate === 0.08)

  const standardRatePercentage = standardRateData
    ? (standardRateData.total / summary.total_amount) * 100
    : 0
  const reducedRatePercentage = reducedRateData
    ? (reducedRateData.total / summary.total_amount) * 100
    : 0

  // ピーク日と最低日を特定
  let peakDay: string | undefined
  let lowestDay: string | undefined
  if (daily_breakdown && daily_breakdown.length > 0) {
    const sortedByAmount = [...daily_breakdown].sort(
      (a, b) => b.total_amount - a.total_amount
    )
    peakDay = sortedByAmount[0]?.date
    lowestDay = sortedByAmount[sortedByAmount.length - 1]?.date
  }

  // コンプライアンスノート生成
  const complianceNotes: string[] = []
  
  if (tax_breakdown.length === 0) {
    complianceNotes.push('警告: 税率データが見つかりません。')
  }
  
  if (reducedRateData && standardRateData) {
    complianceNotes.push('軽減税率(8%)と標準税率(10%)の両方が適用されています。')
  }
  
  if (summary.total_sales_count === 0) {
    complianceNotes.push('この期間に売上データがありません。')
  } else {
    complianceNotes.push(
      `期間内の取引数: ${summary.total_sales_count}件、平均取引額: ¥${Math.round(summary.total_amount / summary.total_sales_count).toLocaleString()}`
    )
  }

  // データ品質ノート
  const dataQualityNotes: string[] = []
  if (daily_breakdown) {
    const daysWithData = daily_breakdown.length
    const periodStart = new Date(period.start_date)
    const periodEnd = new Date(period.end_date)
    const totalDays = Math.ceil(
      (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1
    
    if (daysWithData < totalDays) {
      dataQualityNotes.push(
        `期間${totalDays}日中、${daysWithData}日のデータのみ存在します。`
      )
    }
  }

  return {
    report_metadata: {
      generated_at: new Date().toISOString(),
      report_type: '税務分析レポート',
      period: {
        start_date: period.start_date,
        end_date: period.end_date,
      },
    },
    business_summary: {
      total_revenue: summary.total_amount,
      total_tax_collected: summary.total_tax,
      net_sales: summary.net_amount,
      transaction_count: summary.total_sales_count,
      average_transaction_value:
        summary.total_sales_count > 0
          ? Math.round((summary.total_amount / summary.total_sales_count) * 100) / 100
          : 0,
    },
    tax_analysis: {
      tax_rates_applied: tax_breakdown,
      standard_rate_percentage: Math.round(standardRatePercentage * 100) / 100,
      reduced_rate_percentage: Math.round(reducedRatePercentage * 100) / 100,
    },
    trends: {
      daily_data: daily_breakdown || [],
      peak_day: peakDay,
      lowest_day: lowestDay,
    },
    compliance_notes: complianceNotes,
    raw_data_summary: {
      data_points_count: summary.total_sales_count,
      data_quality_notes: dataQualityNotes,
    },
  }
}

/**
 * 期間指定でsalesを取得し、LLM向けレポートJSON形式で返す
 */
export async function generateTaxAnalysisReportData(
  startDate: string,
  endDate: string
): Promise<TaxAnalysisReport> {
  const aggregation = await getSalesAggregation(startDate, endDate)
  return formatForTaxAnalysisReport(aggregation)
}

/**
 * LLMに渡すためのプロンプト付きデータを生成
 */
export function createLLMPromptWithData(report: TaxAnalysisReport): string {
  const jsonData = JSON.stringify(report, null, 2)
  
  return `以下は${report.report_metadata.period.start_date}から${report.report_metadata.period.end_date}までの売上・税務データです。
このデータを分析して、税務分析レポートを作成してください。

【分析してほしい項目】
1. 売上の全体的な傾向
2. 税率別の売上構成（標準税率10%と軽減税率8%の比率）
3. 日別の売上推移と特記事項
4. 消費税申告に向けた注意点
5. 経営改善のための提案

【データ】
\`\`\`json
${jsonData}
\`\`\`

上記のデータに基づいて、分かりやすい日本語で税務分析レポートを作成してください。`
}
