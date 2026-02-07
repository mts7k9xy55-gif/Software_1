export interface SaleLine {
  name: string
  price: number
  quantity: number
  tax_rate: number
}

export interface SaleRecordLike {
  total_amount: number
  created_at: string
  items?: SaleLine[] | null
}

export interface TaxBucket {
  taxRate: number
  subtotal: number
  tax: number
  total: number
  itemCount: number
}

export interface SalesSummary {
  grossSales: number
  netSales: number
  taxTotal: number
  transactionCount: number
  itemCount: number
  byTaxRate: TaxBucket[]
}

export interface DailySummary {
  date: string
  grossSales: number
  transactionCount: number
}

export function normalizeTaxRate(rate: number | null | undefined): number {
  if (rate == null || Number.isNaN(rate)) return 10
  if (rate > 0 && rate <= 1) return Math.round(rate * 100)
  return Math.round(rate)
}

export function calcLineTotals(price: number, quantity: number, taxRate: number) {
  const safePrice = Math.max(0, Math.floor(price))
  const safeQuantity = Math.max(1, Math.floor(quantity))
  const rate = normalizeTaxRate(taxRate)

  const subtotal = safePrice * safeQuantity
  const tax = Math.floor((subtotal * rate) / 100)
  const total = subtotal + tax

  return { subtotal, tax, total, taxRate: rate }
}

export function summarizeItems(items: SaleLine[]): Omit<SalesSummary, 'transactionCount'> {
  const bucketMap = new Map<number, TaxBucket>()
  let netSales = 0
  let taxTotal = 0
  let grossSales = 0
  let itemCount = 0

  for (const item of items) {
    const line = calcLineTotals(item.price, item.quantity, item.tax_rate)
    const bucket = bucketMap.get(line.taxRate) ?? {
      taxRate: line.taxRate,
      subtotal: 0,
      tax: 0,
      total: 0,
      itemCount: 0,
    }

    bucket.subtotal += line.subtotal
    bucket.tax += line.tax
    bucket.total += line.total
    bucket.itemCount += Math.max(1, Math.floor(item.quantity))

    bucketMap.set(line.taxRate, bucket)

    netSales += line.subtotal
    taxTotal += line.tax
    grossSales += line.total
    itemCount += Math.max(1, Math.floor(item.quantity))
  }

  return {
    grossSales,
    netSales,
    taxTotal,
    itemCount,
    byTaxRate: Array.from(bucketMap.values()).sort((a, b) => a.taxRate - b.taxRate),
  }
}

export function summarizeSales(sales: SaleRecordLike[]): SalesSummary {
  const bucketMap = new Map<number, TaxBucket>()
  let netSales = 0
  let taxTotal = 0
  let grossSales = 0
  let itemCount = 0

  for (const sale of sales) {
    const saleItems = Array.isArray(sale.items) ? sale.items : []

    if (saleItems.length === 0) {
      grossSales += Math.max(0, Math.floor(sale.total_amount || 0))
      continue
    }

    for (const item of saleItems) {
      const line = calcLineTotals(item.price, item.quantity, item.tax_rate)
      const bucket = bucketMap.get(line.taxRate) ?? {
        taxRate: line.taxRate,
        subtotal: 0,
        tax: 0,
        total: 0,
        itemCount: 0,
      }

      bucket.subtotal += line.subtotal
      bucket.tax += line.tax
      bucket.total += line.total
      bucket.itemCount += Math.max(1, Math.floor(item.quantity))

      bucketMap.set(line.taxRate, bucket)

      netSales += line.subtotal
      taxTotal += line.tax
      itemCount += Math.max(1, Math.floor(item.quantity))
    }

    grossSales += Math.max(0, Math.floor(sale.total_amount || 0))
  }

  if (grossSales === 0 && netSales > 0) {
    grossSales = netSales + taxTotal
  }

  return {
    grossSales,
    netSales,
    taxTotal,
    transactionCount: sales.length,
    itemCount,
    byTaxRate: Array.from(bucketMap.values()).sort((a, b) => a.taxRate - b.taxRate),
  }
}

export function summarizeDailySales(sales: SaleRecordLike[]): DailySummary[] {
  const map = new Map<string, DailySummary>()

  for (const sale of sales) {
    const dateKey = sale.created_at.slice(0, 10)
    const existing = map.get(dateKey) ?? {
      date: dateKey,
      grossSales: 0,
      transactionCount: 0,
    }

    existing.grossSales += Math.max(0, Math.floor(sale.total_amount || 0))
    existing.transactionCount += 1
    map.set(dateKey, existing)
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}
