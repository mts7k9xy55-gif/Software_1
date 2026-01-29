export interface Database {
  public: {
    Tables: {
      menu_items: {
        Row: {
          id: number
          name: string
          price: number
          category: string
          image_url?: string
          description?: string
          tax_rate: number // 税率 (例: 0.08 = 8%, 0.10 = 10%)
          created_at: string
        }
        Insert: {
          id?: number
          name: string
          price: number
          category: string
          image_url?: string
          description?: string
          tax_rate?: number
          created_at?: string
        }
        Update: {
          id?: number
          name?: string
          price?: number
          category?: string
          image_url?: string
          description?: string
          tax_rate?: number
          created_at?: string
        }
      }
      sales: {
        Row: {
          id: number
          items: SaleItem[]
          total_amount: number
          tax_details: TaxDetail[]
          created_at: string
        }
        Insert: {
          id?: number
          items: SaleItem[]
          total_amount: number
          tax_details?: TaxDetail[]
          created_at?: string
        }
        Update: {
          id?: number
          items?: SaleItem[]
          total_amount?: number
          tax_details?: TaxDetail[]
          created_at?: string
        }
      }
    }
  }
}

export interface OrderItem {
  menu_item_id: number
  name: string
  price: number
  quantity: number
}

export interface SaleItem {
  menu_item_id: number
  name: string
  price: number
  quantity: number
  tax_rate: number
}

export interface TaxDetail {
  tax_rate: number
  subtotal: number // 税抜金額
  tax_amount: number // 税額
  total: number // 税込金額
}

// 期間指定のsales集計結果
export interface SalesAggregation {
  period: {
    start_date: string
    end_date: string
  }
  summary: {
    total_sales_count: number
    total_amount: number
    total_tax: number
    net_amount: number // 税抜合計
  }
  tax_breakdown: TaxBreakdown[]
  daily_breakdown?: DailyBreakdown[]
}

export interface TaxBreakdown {
  tax_rate: number
  tax_rate_label: string // "8%", "10%" など
  subtotal: number // 税抜金額
  tax_amount: number // 税額
  total: number // 税込金額
  transaction_count: number
}

export interface DailyBreakdown {
  date: string
  total_amount: number
  total_tax: number
  transaction_count: number
}

// LLM向け税務分析レポート用の構造
export interface TaxAnalysisReport {
  report_metadata: {
    generated_at: string
    report_type: string
    period: {
      start_date: string
      end_date: string
    }
  }
  business_summary: {
    total_revenue: number
    total_tax_collected: number
    net_sales: number
    transaction_count: number
    average_transaction_value: number
  }
  tax_analysis: {
    tax_rates_applied: TaxBreakdown[]
    standard_rate_percentage: number // 標準税率の割合
    reduced_rate_percentage: number // 軽減税率の割合
  }
  trends: {
    daily_data: DailyBreakdown[]
    peak_day?: string
    lowest_day?: string
  }
  compliance_notes: string[]
  raw_data_summary: {
    data_points_count: number
    data_quality_notes: string[]
  }
}
