'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import {
  calcLineTotals,
  normalizeTaxRate,
  summarizeDailySales,
  summarizeItems,
  summarizeSales,
} from '@/lib/accounting'

type AppMode = 'register' | 'admin' | 'tax'
type TaxMode = 'takeout' | 'dine-in'

type Notice = {
  type: 'success' | 'error'
  message: string
}

interface MenuItem {
  id: number
  name: string
  price: number
  tax_rate: number
  image_url?: string | null
  shop_id: string
  only_takeout?: boolean | null
  only_eat_in?: boolean | null
}

interface SaleItem {
  id: number
  name: string
  price: number
  quantity: number
  tax_rate: number
}

interface TaxDetail {
  tax_rate: number
  subtotal: number
  tax_amount: number
  total: number
}

interface SaleRecord {
  id: number
  items: SaleItem[]
  total_amount: number
  created_at: string
  shop_id: string
  tax_details?: TaxDetail[]
}

interface CartItem extends MenuItem {
  quantity: number
}

const TAX_RATE_BY_MODE: Record<TaxMode, number> = {
  takeout: 8,
  'dine-in': 10,
}

const yenFormatter = new Intl.NumberFormat('ja-JP')

function formatYen(value: number): string {
  return `¥${yenFormatter.format(Math.floor(value))}`
}

function toDateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function getThisMonthStart(): string {
  const now = new Date()
  return toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1))
}

function getLastMonthRange(): { start: string; end: string } {
  const now = new Date()
  const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastDayLastMonth = new Date(firstDayThisMonth.getTime() - 24 * 60 * 60 * 1000)
  const firstDayLastMonth = new Date(lastDayLastMonth.getFullYear(), lastDayLastMonth.getMonth(), 1)

  return {
    start: toDateInputValue(firstDayLastMonth),
    end: toDateInputValue(lastDayLastMonth),
  }
}

function getThisYearStart(): string {
  const now = new Date()
  return toDateInputValue(new Date(now.getFullYear(), 0, 1))
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function toTaxDetails(items: SaleItem[]): TaxDetail[] {
  const itemSummary = summarizeItems(items)
  return itemSummary.byTaxRate.map((bucket) => ({
    tax_rate: bucket.taxRate,
    subtotal: bucket.subtotal,
    tax_amount: bucket.tax,
    total: bucket.total,
  }))
}

function sanitizeMenuItems(input: unknown[]): MenuItem[] {
  return input.map((row) => {
    const record = row as Partial<MenuItem>
    return {
      id: Number(record.id),
      name: String(record.name ?? ''),
      price: Number(record.price ?? 0),
      tax_rate: normalizeTaxRate(Number(record.tax_rate ?? 10)),
      image_url: record.image_url ?? null,
      shop_id: String(record.shop_id ?? ''),
      only_takeout: Boolean(record.only_takeout),
      only_eat_in: Boolean(record.only_eat_in),
    }
  })
}

function sanitizeSales(input: unknown[]): SaleRecord[] {
  return input.map((row) => {
    const record = row as Partial<SaleRecord>

    const itemsRaw = Array.isArray(record.items) ? record.items : []
    const items = itemsRaw.map((item) => {
      const line = item as Partial<SaleItem>
      return {
        id: Number(line.id ?? 0),
        name: String(line.name ?? ''),
        price: Number(line.price ?? 0),
        quantity: Math.max(1, Number(line.quantity ?? 1)),
        tax_rate: normalizeTaxRate(Number(line.tax_rate ?? 10)),
      }
    })

    const taxDetailsRaw = Array.isArray(record.tax_details) ? record.tax_details : []
    const taxDetails = taxDetailsRaw.map((detail) => {
      const d = detail as Partial<TaxDetail>
      return {
        tax_rate: normalizeTaxRate(Number(d.tax_rate ?? 10)),
        subtotal: Number(d.subtotal ?? 0),
        tax_amount: Number(d.tax_amount ?? 0),
        total: Number(d.total ?? 0),
      }
    })

    return {
      id: Number(record.id ?? 0),
      shop_id: String(record.shop_id ?? ''),
      total_amount: Number(record.total_amount ?? 0),
      created_at: String(record.created_at ?? ''),
      items,
      tax_details: taxDetails,
    }
  })
}

type SupabaseLikeError = {
  code?: string
  message?: string
}

function isMissingColumnError(error: SupabaseLikeError | null, columnName: string): boolean {
  if (!error) return false
  const message = error.message ?? ''
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    message.includes(columnName) ||
    message.includes('schema cache')
  )
}

export default function POSSystem() {
  const { user, shopId, shopName, signOut, updateShopName } = useAuth()

  const [mode, setMode] = useState<AppMode>('register')
  const [taxMode, setTaxMode] = useState<TaxMode>('dine-in')

  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [todaySales, setTodaySales] = useState<SaleRecord[]>([])
  const [periodSales, setPeriodSales] = useState<SaleRecord[]>([])
  const [cart, setCart] = useState<CartItem[]>([])

  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isPeriodLoading, setIsPeriodLoading] = useState(false)

  const [notice, setNotice] = useState<Notice | null>(null)

  const [startDate, setStartDate] = useState<string>(getThisMonthStart)
  const [endDate, setEndDate] = useState<string>(() => toDateInputValue(new Date()))

  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newImageFile, setNewImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [newOnlyTakeout, setNewOnlyTakeout] = useState(false)
  const [newOnlyEatIn, setNewOnlyEatIn] = useState(false)

  const [showShopNameModal, setShowShopNameModal] = useState(false)
  const [shopNameInput, setShopNameInput] = useState('')
  const [skipShopNamePrompt, setSkipShopNamePrompt] = useState(false)

  const currentTaxRate = TAX_RATE_BY_MODE[taxMode]

  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (taxMode === 'takeout') return !item.only_eat_in
      return !item.only_takeout
    })
  }, [menuItems, taxMode])

  const cartSaleItems = useMemo<SaleItem[]>(() => {
    return cart.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      tax_rate: currentTaxRate,
    }))
  }, [cart, currentTaxRate])

  const cartSummary = useMemo(() => summarizeItems(cartSaleItems), [cartSaleItems])
  const todaySummary = useMemo(() => summarizeSales(todaySales), [todaySales])
  const periodSummary = useMemo(() => summarizeSales(periodSales), [periodSales])
  const periodDailySummary = useMemo(() => summarizeDailySales(periodSales), [periodSales])

  const fetchMenuItems = useCallback(async () => {
    if (!shopId) return

    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, price, tax_rate, image_url, shop_id, only_takeout, only_eat_in')
      .eq('shop_id', shopId)
      .order('name', { ascending: true })

    if (!error) {
      setMenuItems(sanitizeMenuItems((data ?? []) as unknown[]))
      return
    }

    // Legacy schema fallback (README 初期版): shop_id / tax_rate / only_* が無い場合
    if (
      isMissingColumnError(error, 'shop_id') ||
      isMissingColumnError(error, 'tax_rate') ||
      isMissingColumnError(error, 'only_takeout') ||
      isMissingColumnError(error, 'only_eat_in')
    ) {
      const { data: legacyData, error: legacyError } = await supabase
        .from('menu_items')
        .select('id, name, price, image_url')
        .order('name', { ascending: true })

      if (legacyError) {
        setNotice({ type: 'error', message: `商品取得に失敗しました: ${legacyError.message}` })
        return
      }

      setMenuItems(sanitizeMenuItems((legacyData ?? []) as unknown[]))
      return
    }

    if (error) {
      setNotice({ type: 'error', message: `商品取得に失敗しました: ${error.message}` })
      return
    }
  }, [shopId])

  const fetchTodaySales = useCallback(async () => {
    if (!shopId) return

    const today = toDateInputValue(new Date())

    const { data, error } = await supabase
      .from('sales')
      .select('id, items, total_amount, created_at, shop_id, tax_details')
      .eq('shop_id', shopId)
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`)
      .order('created_at', { ascending: false })

    if (!error) {
      setTodaySales(sanitizeSales((data ?? []) as unknown[]))
      return
    }

    if (isMissingColumnError(error, 'shop_id') || isMissingColumnError(error, 'tax_details')) {
      const { data: legacyData, error: legacyError } = await supabase
        .from('sales')
        .select('id, items, total_amount, created_at')
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`)
        .order('created_at', { ascending: false })

      if (legacyError) {
        setNotice({ type: 'error', message: `本日の売上取得に失敗しました: ${legacyError.message}` })
        return
      }

      setTodaySales(sanitizeSales((legacyData ?? []) as unknown[]))
      return
    }

    if (error) {
      setNotice({ type: 'error', message: `本日の売上取得に失敗しました: ${error.message}` })
      return
    }
  }, [shopId])

  const fetchPeriodSales = useCallback(async () => {
    if (!shopId) return

    if (!startDate || !endDate) {
      setNotice({ type: 'error', message: '開始日と終了日を設定してください。' })
      return
    }

    if (startDate > endDate) {
      setNotice({ type: 'error', message: '終了日は開始日以降にしてください。' })
      return
    }

    setIsPeriodLoading(true)
    setNotice(null)

    const { data, error } = await supabase
      .from('sales')
      .select('id, items, total_amount, created_at, shop_id, tax_details')
      .eq('shop_id', shopId)
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .order('created_at', { ascending: false })

    setIsPeriodLoading(false)

    if (!error) {
      setPeriodSales(sanitizeSales((data ?? []) as unknown[]))
      return
    }

    if (isMissingColumnError(error, 'shop_id') || isMissingColumnError(error, 'tax_details')) {
      const { data: legacyData, error: legacyError } = await supabase
        .from('sales')
        .select('id, items, total_amount, created_at')
        .gte('created_at', `${startDate}T00:00:00`)
        .lte('created_at', `${endDate}T23:59:59`)
        .order('created_at', { ascending: false })

      if (legacyError) {
        setNotice({ type: 'error', message: `期間売上取得に失敗しました: ${legacyError.message}` })
        return
      }

      setPeriodSales(sanitizeSales((legacyData ?? []) as unknown[]))
      return
    }

    if (error) {
      setNotice({ type: 'error', message: `期間売上取得に失敗しました: ${error.message}` })
      return
    }
  }, [endDate, shopId, startDate])

  useEffect(() => {
    if (!shopId) return

    let active = true
    setIsInitialLoading(true)

    Promise.all([fetchMenuItems(), fetchTodaySales()]).finally(() => {
      if (active) setIsInitialLoading(false)
    })

    return () => {
      active = false
    }
  }, [shopId, fetchMenuItems, fetchTodaySales])

  useEffect(() => {
    if (shopId && !isInitialLoading && shopName === null && !skipShopNamePrompt) {
      setShowShopNameModal(true)
    }
  }, [shopId, isInitialLoading, shopName, skipShopNamePrompt])

  const addItemToCart = (item: MenuItem) => {
    setNotice(null)
    setCart((prev) => {
      const existingIndex = prev.findIndex((cartItem) => cartItem.id === item.id)
      if (existingIndex >= 0) {
        const next = [...prev]
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + 1,
        }
        return next
      }

      return [...prev, { ...item, quantity: 1 }]
    })
  }

  const updateCartQuantity = (itemId: number, nextQuantity: number) => {
    setCart((prev) => {
      if (nextQuantity <= 0) {
        return prev.filter((item) => item.id !== itemId)
      }

      return prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              quantity: nextQuantity,
            }
          : item
      )
    })
  }

  const clearCart = () => {
    setCart([])
  }

  const handleCheckout = async () => {
    if (!shopId || cartSaleItems.length === 0) return

    setIsSavingOrder(true)
    setNotice(null)

    const payload = {
      shop_id: shopId,
      items: cartSaleItems,
      total_amount: cartSummary.grossSales,
      tax_details: toTaxDetails(cartSaleItems),
    }

    let { error } = await supabase.from('sales').insert(payload)

    if (error && (isMissingColumnError(error, 'shop_id') || isMissingColumnError(error, 'tax_details'))) {
      const legacyPayload = {
        items: cartSaleItems,
        total_amount: cartSummary.grossSales,
      }
      const retry = await supabase.from('sales').insert(legacyPayload)
      error = retry.error
    }

    setIsSavingOrder(false)

    if (error) {
      setNotice({ type: 'error', message: `会計の保存に失敗しました: ${error.message}` })
      return
    }

    setCart([])
    await fetchTodaySales()
    setNotice({
      type: 'success',
      message: `会計を記帳しました（${formatYen(cartSummary.grossSales)} / ${cartSummary.itemCount}点）`,
    })
  }

  const deleteMenuItem = async (id: number) => {
    const shouldDelete = window.confirm('この商品を削除しますか？')
    if (!shouldDelete) return

    const { error } = await supabase.from('menu_items').delete().eq('id', id)

    if (error) {
      setNotice({ type: 'error', message: `商品削除に失敗しました: ${error.message}` })
      return
    }

    await fetchMenuItems()
    setNotice({ type: 'success', message: '商品を削除しました。' })
  }

  const updateItemVisibility = async (
    id: number,
    field: 'only_takeout' | 'only_eat_in',
    value: boolean
  ) => {
    const payload = field === 'only_takeout'
      ? { only_takeout: value, only_eat_in: value ? false : undefined }
      : { only_eat_in: value, only_takeout: value ? false : undefined }

    const { error } = await supabase.from('menu_items').update(payload).eq('id', id)

    if (error) {
      setNotice({ type: 'error', message: `表示制限の更新に失敗しました: ${error.message}` })
      return
    }

    await fetchMenuItems()
  }

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setNewImageFile(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(typeof reader.result === 'string' ? reader.result : null)
    }
    reader.readAsDataURL(file)
  }

  const uploadImage = async (file: File): Promise<string | null> => {
    if (!shopId) return null

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
    const fileName = `${shopId}/${Date.now()}.${extension}`

    const { error } = await supabase.storage.from('product-images').upload(fileName, file)
    if (error) {
      return null
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('product-images').getPublicUrl(fileName)

    return publicUrl
  }

  const handleProductSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!shopId) return
    const trimmedName = newName.trim()
    const parsedPrice = Number(newPrice)

    if (!trimmedName) {
      setNotice({ type: 'error', message: '商品名を入力してください。' })
      return
    }

    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setNotice({ type: 'error', message: '価格は1円以上の数値で入力してください。' })
      return
    }

    setIsUploading(true)
    setNotice(null)

    let imageUrl: string | null = null
    if (newImageFile) {
      imageUrl = await uploadImage(newImageFile)
      if (!imageUrl) {
        setIsUploading(false)
        setNotice({ type: 'error', message: '画像アップロードに失敗しました。' })
        return
      }
    }

    let { error } = await supabase.from('menu_items').insert({
      shop_id: shopId,
      name: trimmedName,
      price: Math.floor(parsedPrice),
      tax_rate: 10,
      category: 'その他',
      image_url: imageUrl,
      only_takeout: newOnlyTakeout,
      only_eat_in: newOnlyEatIn,
    })

    if (
      error &&
      (
        isMissingColumnError(error, 'shop_id') ||
        isMissingColumnError(error, 'tax_rate') ||
        isMissingColumnError(error, 'only_takeout') ||
        isMissingColumnError(error, 'only_eat_in')
      )
    ) {
      const legacyPayload = {
        name: trimmedName,
        price: Math.floor(parsedPrice),
        category: 'その他',
        image_url: imageUrl,
      }
      const retry = await supabase.from('menu_items').insert(legacyPayload)
      error = retry.error
    }

    setIsUploading(false)

    if (error) {
      setNotice({ type: 'error', message: `商品登録に失敗しました: ${error.message}` })
      return
    }

    setNewName('')
    setNewPrice('')
    setNewImageFile(null)
    setImagePreview(null)
    setNewOnlyTakeout(false)
    setNewOnlyEatIn(false)
    await fetchMenuItems()
    setNotice({ type: 'success', message: '商品を登録しました。' })
  }

  const handleShopNameSubmit = async () => {
    const name = shopNameInput.trim()
    if (!name) return

    const { error } = await updateShopName(name)
    if (error) {
      setNotice({ type: 'error', message: `店舗名の保存に失敗しました: ${error.message}` })
      return
    }

    setShowShopNameModal(false)
    setShopNameInput('')
    setNotice({ type: 'success', message: '店舗名を更新しました。' })
  }

  const applyRangePreset = (preset: 'thisMonth' | 'lastMonth' | 'thisYear') => {
    if (preset === 'thisMonth') {
      setStartDate(getThisMonthStart())
      setEndDate(toDateInputValue(new Date()))
      return
    }

    if (preset === 'lastMonth') {
      const range = getLastMonthRange()
      setStartDate(range.start)
      setEndDate(range.end)
      return
    }

    setStartDate(getThisYearStart())
    setEndDate(toDateInputValue(new Date()))
  }

  const exportPeriodCsv = () => {
    if (periodSales.length === 0) {
      setNotice({ type: 'error', message: 'CSV出力する売上がありません。' })
      return
    }

    const header = [
      '日時',
      '商品明細',
      '税抜売上',
      '消費税',
      '税込売上',
      '適用税率',
    ]

    const rows = periodSales.map((sale) => {
      const itemSummary = summarizeItems(sale.items)
      const itemLabel = sale.items.map((item) => `${item.name} x${item.quantity}`).join(' / ')
      const rateLabel = itemSummary.byTaxRate.map((bucket) => `${bucket.taxRate}%`).join(', ')

      return [
        escapeCsv(formatDateTime(sale.created_at)),
        escapeCsv(itemLabel),
        String(itemSummary.netSales),
        String(itemSummary.taxTotal),
        String(sale.total_amount),
        escapeCsv(rateLabel),
      ]
    })

    const csv = ['\uFEFF' + header.join(','), ...rows.map((row) => row.join(','))].join('\n')
    downloadTextFile(
      `sales-ledger-${startDate}-to-${endDate}.csv`,
      csv,
      'text/csv;charset=utf-8;'
    )
  }

  const exportPeriodPdf = async () => {
    if (periodSales.length === 0) {
      setNotice({ type: 'error', message: 'PDF出力する売上がありません。' })
      return
    }

    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default

    const doc = new jsPDF()

    doc.setFont('helvetica')
    doc.setFontSize(14)
    doc.text(`${shopName ?? 'POS'} Tax Ledger`, 14, 16)
    doc.setFontSize(10)
    doc.text(`Period: ${startDate} - ${endDate}`, 14, 24)

    autoTable(doc, {
      startY: 30,
      head: [['Tax Rate', 'Net Sales', 'Tax', 'Gross']],
      body: periodSummary.byTaxRate.map((bucket) => [
        `${bucket.taxRate}%`,
        formatYen(bucket.subtotal),
        formatYen(bucket.tax),
        formatYen(bucket.total),
      ]),
      foot: [[
        'Total',
        formatYen(periodSummary.netSales),
        formatYen(periodSummary.taxTotal),
        formatYen(periodSummary.grossSales),
      ]],
      styles: {
        font: 'helvetica',
        fontSize: 9,
      },
    })

    const startY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 54

    autoTable(doc, {
      startY: startY + 8,
      head: [['Date', 'Transactions', 'Gross Sales']],
      body: periodDailySummary.map((row) => [
        row.date,
        String(row.transactionCount),
        formatYen(row.grossSales),
      ]),
      styles: {
        font: 'helvetica',
        fontSize: 9,
      },
    })

    doc.save(`tax-ledger-${startDate}-to-${endDate}.pdf`)
  }

  if (isInitialLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="rounded-xl border border-slate-200 bg-white px-8 py-6 text-center shadow-sm">
          <p className="text-slate-600">データを読み込んでいます...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200">
      {showShopNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-900">店舗名を設定</h2>
            <p className="mt-2 text-sm text-slate-600">ヘッダーに表示される店舗名を入力してください。</p>
            <input
              type="text"
              value={shopNameInput}
              onChange={(event) => setShopNameInput(event.target.value)}
              className="mt-4 w-full rounded-lg border border-slate-300 p-3"
              placeholder="例: えがおカフェ"
              autoFocus
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleShopNameSubmit}
                disabled={!shopNameInput.trim()}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-3 font-bold text-white disabled:bg-slate-300"
              >
                保存
              </button>
              <button
                onClick={() => {
                  setShowShopNameModal(false)
                  setSkipShopNamePrompt(true)
                  setShopNameInput('')
                }}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-3 font-bold text-slate-700"
              >
                スキップ
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl gap-2 p-3">
          <button
            onClick={() => setTaxMode('takeout')}
            className={`flex-1 rounded-xl px-4 py-4 text-lg font-bold transition ${
              taxMode === 'takeout'
                ? 'bg-orange-500 text-white shadow'
                : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
            }`}
          >
            テイクアウト 8%
          </button>
          <button
            onClick={() => setTaxMode('dine-in')}
            className={`flex-1 rounded-xl px-4 py-4 text-lg font-bold transition ${
              taxMode === 'dine-in'
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            店内飲食 10%
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl p-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-slate-900">
                  {shopName ? `${shopName} 売上中枢` : '売上中枢'}
                </h1>
                <button
                  onClick={() => {
                    setSkipShopNamePrompt(false)
                    setShowShopNameModal(true)
                    setShopNameInput(shopName ?? '')
                  }}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                >
                  店舗名を編集
                </button>
              </div>
              <p className="text-sm text-slate-500">{user?.email}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setMode('register')}
                className={`rounded-lg px-4 py-2 font-bold ${
                  mode === 'register' ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-700'
                }`}
              >
                注文会計
              </button>
              <button
                onClick={() => setMode('admin')}
                className={`rounded-lg px-4 py-2 font-bold ${
                  mode === 'admin' ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-700'
                }`}
              >
                メニュー管理
              </button>
              <button
                onClick={() => setMode('tax')}
                className={`rounded-lg px-4 py-2 font-bold ${
                  mode === 'tax' ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-700'
                }`}
              >
                税務レポート
              </button>
              <button
                onClick={signOut}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-bold text-slate-700"
              >
                ログアウト
              </button>
            </div>
          </div>

          {notice && (
            <div
              className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                notice.type === 'success'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              {notice.message}
            </div>
          )}
        </div>

        {mode === 'register' && (
          <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">メニューから注文を作成</h2>
                <button
                  onClick={fetchMenuItems}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700"
                >
                  更新
                </button>
              </div>

              {filteredMenuItems.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-6 text-center text-slate-500">
                  表示できる商品がありません。メニュー管理で商品を登録してください。
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {filteredMenuItems.map((item) => {
                    const line = calcLineTotals(item.price, 1, currentTaxRate)
                    return (
                      <button
                        key={item.id}
                        onClick={() => addItemToCart(item)}
                        className="overflow-hidden rounded-xl border-2 border-slate-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow"
                      >
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.name} className="h-28 w-full object-cover" />
                        ) : (
                          <div className="flex h-28 w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-3xl">
                            🛒
                          </div>
                        )}
                        <div className="p-3">
                          <p className="truncate font-bold text-slate-900">{item.name}</p>
                          <p className="text-lg font-black text-blue-700">{formatYen(line.total)}</p>
                          <p className="text-xs text-slate-500">税抜 {formatYen(item.price)}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-xl bg-blue-600 p-4 text-white shadow">
                  <p className="text-xs opacity-80">本日の税込売上</p>
                  <p className="mt-1 text-2xl font-black">{formatYen(todaySummary.grossSales)}</p>
                </div>
                <div className="rounded-xl bg-slate-900 p-4 text-white shadow">
                  <p className="text-xs opacity-80">本日の税抜売上</p>
                  <p className="mt-1 text-2xl font-black">{formatYen(todaySummary.netSales)}</p>
                </div>
                <div className="rounded-xl bg-emerald-600 p-4 text-white shadow">
                  <p className="text-xs opacity-80">本日の消費税</p>
                  <p className="mt-1 text-2xl font-black">{formatYen(todaySummary.taxTotal)}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">現在の注文</h3>
                  {cart.length > 0 && (
                    <button
                      onClick={clearCart}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
                    >
                      クリア
                    </button>
                  )}
                </div>

                {cart.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">まだ商品が追加されていません。</p>
                ) : (
                  <div className="space-y-3">
                    {cart.map((item) => {
                      const line = calcLineTotals(item.price, item.quantity, currentTaxRate)
                      return (
                        <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-slate-900">{item.name}</p>
                            <button
                              onClick={() => updateCartQuantity(item.id, 0)}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500"
                            >
                              削除
                            </button>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => updateCartQuantity(item.id, item.quantity - 1)}
                                className="h-7 w-7 rounded-md border border-slate-300 text-slate-700"
                              >
                                -
                              </button>
                              <span className="w-8 text-center font-bold">{item.quantity}</span>
                              <button
                                onClick={() => updateCartQuantity(item.id, item.quantity + 1)}
                                className="h-7 w-7 rounded-md border border-slate-300 text-slate-700"
                              >
                                +
                              </button>
                            </div>
                            <p className="font-bold text-slate-900">{formatYen(line.total)}</p>
                          </div>
                        </div>
                      )
                    })}

                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                      <div className="flex justify-between">
                        <span>税抜合計</span>
                        <span>{formatYen(cartSummary.netSales)}</span>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span>消費税</span>
                        <span>{formatYen(cartSummary.taxTotal)}</span>
                      </div>
                      <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-black">
                        <span>請求合計</span>
                        <span>{formatYen(cartSummary.grossSales)}</span>
                      </div>
                    </div>

                    <button
                      onClick={handleCheckout}
                      disabled={isSavingOrder}
                      className="w-full rounded-xl bg-blue-600 px-4 py-3 text-lg font-black text-white disabled:bg-slate-400"
                    >
                      {isSavingOrder ? '記帳中...' : '会計を確定して記帳'}
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">本日の注文履歴</h3>
                  <button
                    onClick={fetchTodaySales}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                  >
                    更新
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        <th className="p-2 text-left">時刻</th>
                        <th className="p-2 text-left">商品</th>
                        <th className="p-2 text-right">税込</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todaySales.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-4 text-center text-slate-400">
                            まだ注文がありません。
                          </td>
                        </tr>
                      ) : (
                        todaySales.map((sale) => (
                          <tr key={sale.id} className="border-b border-slate-100">
                            <td className="p-2 text-slate-600">{formatDateTime(sale.created_at)}</td>
                            <td className="p-2">
                              {sale.items.map((item) => `${item.name} x${item.quantity}`).join(', ')}
                            </td>
                            <td className="p-2 text-right font-bold">{formatYen(sale.total_amount)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </aside>
          </div>
        )}

        {mode === 'admin' && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">商品登録</h2>
              <p className="mt-1 text-sm text-slate-500">税率は会計時に自動適用されます（8% / 10%）。</p>

              <form onSubmit={handleProductSubmit} className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-semibold">商品名</label>
                  <input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-3"
                    placeholder="例: 自家製レモネード"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold">税抜価格</label>
                  <input
                    type="number"
                    min={1}
                    value={newPrice}
                    onChange={(event) => setNewPrice(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-3"
                    placeholder="例: 480"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold">商品画像（任意）</label>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageChange}
                    className="w-full rounded-lg border border-slate-300 bg-white p-3"
                  />
                  {imagePreview && (
                    <img
                      src={imagePreview}
                      alt="プレビュー"
                      className="mt-2 h-24 w-24 rounded-lg border border-slate-300 object-cover"
                    />
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold">表示制限（任意）</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newOnlyTakeout}
                        onChange={(event) => {
                          setNewOnlyTakeout(event.target.checked)
                          if (event.target.checked) setNewOnlyEatIn(false)
                        }}
                      />
                      テイクアウトのみ
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newOnlyEatIn}
                        onChange={(event) => {
                          setNewOnlyEatIn(event.target.checked)
                          if (event.target.checked) setNewOnlyTakeout(false)
                        }}
                      />
                      店内飲食のみ
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isUploading}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:bg-slate-400"
                >
                  {isUploading ? '登録中...' : '商品を登録'}
                </button>
              </form>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">登録済み商品</h2>
                <button
                  onClick={fetchMenuItems}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700"
                >
                  更新
                </button>
              </div>

              <div className="max-h-[640px] space-y-3 overflow-y-auto">
                {menuItems.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">商品がまだ登録されていません。</p>
                ) : (
                  menuItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center gap-3">
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.name} className="h-12 w-12 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-xl">🍽️</div>
                        )}

                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          <p className="text-sm text-slate-500">税抜 {formatYen(item.price)}</p>
                        </div>

                        <button
                          onClick={() => deleteMenuItem(item.id)}
                          className="rounded-md border border-red-200 px-2 py-1 text-sm text-red-600"
                        >
                          削除
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                        <button
                          onClick={() => updateItemVisibility(item.id, 'only_takeout', !item.only_takeout)}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            item.only_takeout
                              ? 'border-orange-500 bg-orange-500 text-white'
                              : 'border-slate-300 bg-white text-slate-700'
                          }`}
                        >
                          テイクアウトのみ
                        </button>
                        <button
                          onClick={() => updateItemVisibility(item.id, 'only_eat_in', !item.only_eat_in)}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            item.only_eat_in
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-slate-300 bg-white text-slate-700'
                          }`}
                        >
                          店内飲食のみ
                        </button>
                        {!item.only_takeout && !item.only_eat_in && (
                          <span className="self-center text-xs text-slate-400">両モードで表示</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {mode === 'tax' && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">税務レポート（売上帳簿）</h2>
            <p className="mt-1 text-sm text-slate-500">
              期間を指定して、売上・消費税・日次推移を集計します。CSV / PDFで保存できます。
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold">開始日</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="rounded-lg border border-slate-300 p-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold">終了日</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="rounded-lg border border-slate-300 p-2"
                  />
                </div>

                <button
                  onClick={fetchPeriodSales}
                  disabled={isPeriodLoading}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:bg-slate-400"
                >
                  {isPeriodLoading ? '集計中...' : '集計'}
                </button>

                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    onClick={() => applyRangePreset('thisMonth')}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    今月
                  </button>
                  <button
                    onClick={() => applyRangePreset('lastMonth')}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    先月
                  </button>
                  <button
                    onClick={() => applyRangePreset('thisYear')}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    今年
                  </button>
                </div>
              </div>
            </div>

            {periodSales.length > 0 ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-blue-600 p-4 text-white">
                    <p className="text-xs opacity-80">税込売上</p>
                    <p className="mt-1 text-2xl font-black">{formatYen(periodSummary.grossSales)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-900 p-4 text-white">
                    <p className="text-xs opacity-80">税抜売上</p>
                    <p className="mt-1 text-2xl font-black">{formatYen(periodSummary.netSales)}</p>
                  </div>
                  <div className="rounded-xl bg-emerald-600 p-4 text-white">
                    <p className="text-xs opacity-80">消費税</p>
                    <p className="mt-1 text-2xl font-black">{formatYen(periodSummary.taxTotal)}</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="mb-3 font-bold text-slate-900">税率別内訳</h3>
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="p-2 text-left">税率</th>
                          <th className="p-2 text-right">税抜</th>
                          <th className="p-2 text-right">税額</th>
                          <th className="p-2 text-right">税込</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodSummary.byTaxRate.map((bucket) => (
                          <tr key={bucket.taxRate} className="border-b border-slate-100">
                            <td className="p-2 font-semibold">{bucket.taxRate}%</td>
                            <td className="p-2 text-right">{formatYen(bucket.subtotal)}</td>
                            <td className="p-2 text-right">{formatYen(bucket.tax)}</td>
                            <td className="p-2 text-right font-bold">{formatYen(bucket.total)}</td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50 font-bold">
                          <td className="p-2">合計</td>
                          <td className="p-2 text-right">{formatYen(periodSummary.netSales)}</td>
                          <td className="p-2 text-right">{formatYen(periodSummary.taxTotal)}</td>
                          <td className="p-2 text-right">{formatYen(periodSummary.grossSales)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="mb-3 font-bold text-slate-900">帳簿仕訳サマリー</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                        <span>現金 / 売掛金（借方）</span>
                        <span className="font-bold">{formatYen(periodSummary.grossSales)}</span>
                      </div>
                      <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                        <span>売上高（貸方）</span>
                        <span className="font-bold">{formatYen(periodSummary.netSales)}</span>
                      </div>
                      <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                        <span>仮受消費税（貸方）</span>
                        <span className="font-bold">{formatYen(periodSummary.taxTotal)}</span>
                      </div>
                      <div className="pt-2 text-xs text-slate-500">
                        参考値です。最終申告は顧問税理士または会計ソフトの仕訳ルールに合わせてください。
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="mb-3 font-bold text-slate-900">日次推移</h3>
                    <div className="max-h-56 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr>
                            <th className="p-2 text-left">日付</th>
                            <th className="p-2 text-right">取引数</th>
                            <th className="p-2 text-right">税込売上</th>
                          </tr>
                        </thead>
                        <tbody>
                          {periodDailySummary.map((row) => (
                            <tr key={row.date} className="border-b border-slate-100">
                              <td className="p-2">{formatDate(`${row.date}T00:00:00`)}</td>
                              <td className="p-2 text-right">{row.transactionCount}</td>
                              <td className="p-2 text-right font-semibold">{formatYen(row.grossSales)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="mb-3 font-bold text-slate-900">エクスポート</h3>
                    <div className="space-y-2">
                      <button
                        onClick={exportPeriodCsv}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-semibold"
                      >
                        CSVで保存
                      </button>
                      <button
                        onClick={exportPeriodPdf}
                        className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white"
                      >
                        PDFで保存
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 p-3 font-bold">
                    売上明細（{periodSummary.transactionCount}件）
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-100">
                        <tr>
                          <th className="p-2 text-left">日時</th>
                          <th className="p-2 text-left">商品</th>
                          <th className="p-2 text-right">税抜</th>
                          <th className="p-2 text-right">税額</th>
                          <th className="p-2 text-right">税込</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodSales.map((sale) => {
                          const itemSummary = summarizeItems(sale.items)
                          return (
                            <tr key={sale.id} className="border-b border-slate-100">
                              <td className="p-2 text-slate-600">{formatDateTime(sale.created_at)}</td>
                              <td className="p-2">
                                {sale.items.map((item) => `${item.name} x${item.quantity}`).join(', ')}
                              </td>
                              <td className="p-2 text-right">{formatYen(itemSummary.netSales)}</td>
                              <td className="p-2 text-right">{formatYen(itemSummary.taxTotal)}</td>
                              <td className="p-2 text-right font-bold">{formatYen(sale.total_amount)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-slate-50 p-6 text-center text-slate-500">
                期間を指定して「集計」を押すと、税務レポートを表示します。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
