'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isInvalidUuidError, toDeterministicUuid } from '@/lib/supabaseHelpers'
import JSZip from 'jszip'
import {
  calcLineTotals,
  normalizeTaxRate,
  summarizeDailySales,
  summarizeItems,
  summarizeSales,
} from '@/lib/accounting'
import {
  classifyExpenses,
  summarizeClassifiedExpenses,
  type ClassifiedExpense,
} from '@/lib/taxAutopilot'
import {
  buildFilingReadiness,
  type FilingItemStatus,
  type FilingReadiness,
  type FilingReadinessStatus,
} from '@/lib/filingReadiness'

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
  stock_quantity?: number | null
  stock_alert_threshold?: number | null
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

interface ExpenseRecord {
  id: string
  shop_id: string
  expense_date: string
  amount: number
  description: string
  receipt_url: string | null
  created_at: string
}

interface InventoryAdjustmentRecord {
  id: string
  shop_id: string
  fiscal_year: number
  amount: number
}

interface StaffShiftRecord {
  id: string
  shop_id: string
  shift_date: string
  staff_name: string
  start_time: string
  end_time: string
  hourly_wage: number
  break_minutes: number
  created_at: string
}

interface SetupIssue {
  id: string
  title: string
  detail: string
  actionLabel: string
  actionBody: string
}

interface FreeeStatus {
  configured: boolean
  connected: boolean
  companyId: number | null
  hasRefreshToken: boolean
  message: string
}

interface FreeeCompany {
  id: number
  display_name?: string
  company_number?: string
  role?: string
}

interface FreeeCompaniesResult {
  selectedCompanyId: number | null
  companies: FreeeCompany[]
  error?: string
  status?: number
}

interface FreeeAccountItem {
  id: number
  name: string
  default_tax_code?: number | null
}

interface FreeeAccountItemsResult {
  accountItems: FreeeAccountItem[]
  error?: string
  status?: number
}

interface FreeeTax {
  code: number
  name: string
  name_ja?: string
  display_category?: string
  available?: boolean
}

interface FreeeTaxesResult {
  taxes: FreeeTax[]
  source?: string
  hint?: string
  lastStatus?: number
  error?: string
  status?: number
}

interface FreeeSendSummary {
  success: number
  failed: number
  total: number
  lastRunAt: string
}

interface TaxClassifyApiResponse {
  ok: boolean
  classifications?: ClassifiedExpense[]
  message?: string
}

interface TaxOcrApiResponse {
  ok: boolean
  expense?: {
    expense_date: string
    amount: number
    description: string
    merchant?: string
  }
  message?: string
  error?: string
}

interface ReceiptUploadApiResponse {
  ok: boolean
  filePath?: string
  error?: string
}

interface ReceiptSignedUrlApiResponse {
  ok: boolean
  signedUrl?: string
  error?: string
}

function formatFreeeTaxLabel(tax: FreeeTax): string {
  const ja = String(tax.name_ja ?? '').trim()
  if (ja) return ja

  const raw = String(tax.name ?? '').trim()
  if (!raw) return ''

  // Example: purchase_with_tax_10 / sale_without_tax_8
  const m = raw.match(/^(purchase|sale)_(with|without)_tax_(\d+)$/)
  if (m) {
    const kind = m[1] === 'purchase' ? '仕入' : '売上'
    const inclusive = m[2] === 'with' ? '税込' : '税抜'
    const rate = m[3]
    return `課税${kind} ${rate}%（${inclusive}）`
  }

  const simpleMap: Record<string, string> = {
    no_tax: '対象外',
    non_taxable: '不課税',
    tax_exempt: '免税',
    exempt: '免税',
    tax_free: '免税',
    free: '免税',
    excluded: '対象外',
    out_of_scope: '対象外',
  }
  if (simpleMap[raw]) return simpleMap[raw]

  return raw
}

interface CartItem extends MenuItem {
  quantity: number
}

const TAX_RATE_BY_MODE: Record<TaxMode, number> = {
  takeout: 8,
  'dine-in': 10,
}

const LEDGER_SETUP_SQL = `create extension if not exists pgcrypto;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  expense_date date not null,
  amount integer not null check (amount >= 0),
  description text not null,
  receipt_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_shop_date
  on public.expenses(shop_id, expense_date desc);

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  fiscal_year integer not null check (fiscal_year between 2000 and 9999),
  amount integer not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, fiscal_year)
);

create index if not exists idx_inventory_adjustments_shop_year
  on public.inventory_adjustments(shop_id, fiscal_year);

alter table if exists public.menu_items
  add column if not exists stock_quantity integer,
  add column if not exists stock_alert_threshold integer;

create table if not exists public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  shift_date date not null,
  staff_name text not null,
  start_time text not null,
  end_time text not null,
  hourly_wage integer not null check (hourly_wage >= 0),
  break_minutes integer not null default 0 check (break_minutes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_staff_shifts_shop_date
  on public.staff_shifts(shop_id, shift_date desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  actor_clerk_id text not null,
  event_type text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_shop_created
  on public.audit_logs(shop_id, created_at desc);`

const EXPENSE_BUCKET_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do update set public = false;

-- クライアント直接アクセスではなく、サーバーAPI（service role）経由で扱う前提。
-- 既存の公開ポリシーは削除する。
drop policy if exists "Expense receipts public read" on storage.objects;
drop policy if exists "Expense receipts public upload" on storage.objects;`

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

function getPreviousFiscalYearRange(): { start: string; end: string } {
  const now = new Date()
  const year = now.getFullYear() - 1
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  }
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

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i]
    const next = content[i + 1]

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell.trim())
      cell = ''
      continue
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1
      row.push(cell.trim())
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += ch
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    if (row.some((v) => v !== '')) rows.push(row)
  }

  return rows
}

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '').replace(/[_\-()（）]/g, '')
}

function findHeaderIndex(headers: string[], keywords: string[]): number {
  return headers.findIndex((h) => keywords.some((k) => h.includes(k)))
}

function parseAmount(value: string): number {
  const normalized = value.replace(/[¥￥,\s]/g, '')
  const num = Number(normalized)
  if (!Number.isFinite(num)) return NaN
  return Math.floor(num)
}

function parseDateYmd(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  const normalized = text.replace(/[./年]/g, '-').replace(/月/g, '-').replace(/日/g, '')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toShiftHours(startTime: string, endTime: string, breakMinutes: number): number {
  const [sh = '0', sm = '0'] = startTime.split(':')
  const [eh = '0', em = '0'] = endTime.split(':')
  const start = Number(sh) * 60 + Number(sm)
  const end = Number(eh) * 60 + Number(em)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  let minutes = end - start
  if (minutes < 0) minutes += 24 * 60
  minutes -= Math.max(0, breakMinutes)
  if (minutes < 0) minutes = 0
  return Math.round((minutes / 60) * 100) / 100
}

function filingItemStatusLabel(status: FilingItemStatus): string {
  if (status === 'READY') return '完了'
  if (status === 'REVIEW') return '確認'
  return '要対応'
}

function filingItemStatusClass(status: FilingItemStatus): string {
  if (status === 'READY') return 'bg-emerald-100 text-emerald-700'
  if (status === 'REVIEW') return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

function filingReadinessStatusLabel(status: FilingReadinessStatus): string {
  if (status === 'READY') return '準備完了'
  if (status === 'REVIEW_REQUIRED') return '要確認'
  return '要対応'
}

function filingReadinessStatusClass(status: FilingReadinessStatus): string {
  if (status === 'READY') return 'text-emerald-700'
  if (status === 'REVIEW_REQUIRED') return 'text-amber-700'
  return 'text-red-700'
}

function workflowStepClass(status: 'done' | 'review' | 'blocked' | 'ready' | 'pending'): string {
  if (status === 'done' || status === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'review') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'blocked') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-600'
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

function downloadBlobFile(filename: string, blob: Blob): void {
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
      stock_quantity:
        record.stock_quantity == null || Number.isNaN(Number(record.stock_quantity))
          ? null
          : Math.floor(Number(record.stock_quantity)),
      stock_alert_threshold:
        record.stock_alert_threshold == null || Number.isNaN(Number(record.stock_alert_threshold))
          ? null
          : Math.floor(Number(record.stock_alert_threshold)),
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

function sanitizeExpenses(input: unknown[]): ExpenseRecord[] {
  return input.map((row) => {
    const record = row as Partial<ExpenseRecord>
    return {
      id: String(record.id ?? ''),
      shop_id: String(record.shop_id ?? ''),
      expense_date: String(record.expense_date ?? ''),
      amount: Math.max(0, Math.floor(Number(record.amount ?? 0))),
      description: String(record.description ?? ''),
      receipt_url: record.receipt_url ?? null,
      created_at: String(record.created_at ?? ''),
    }
  })
}

function sanitizeShifts(input: unknown[]): StaffShiftRecord[] {
  return input.map((row) => {
    const record = row as Partial<StaffShiftRecord>
    return {
      id: String(record.id ?? ''),
      shop_id: String(record.shop_id ?? ''),
      shift_date: String(record.shift_date ?? ''),
      staff_name: String(record.staff_name ?? ''),
      start_time: String(record.start_time ?? ''),
      end_time: String(record.end_time ?? ''),
      hourly_wage: Math.max(0, Math.floor(Number(record.hourly_wage ?? 0))),
      break_minutes: Math.max(0, Math.floor(Number(record.break_minutes ?? 0))),
      created_at: String(record.created_at ?? ''),
    }
  })
}

function isMissingColumnError(error: { code?: string; message?: string } | null, columnName: string): boolean {
  if (!error) return false
  const message = error.message ?? ''
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    message.includes(columnName) ||
    message.includes('schema cache')
  )
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const message = error.message ?? ''
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    message.includes('Could not find the table') ||
    message.includes('does not exist')
  )
}

export default function POSSystem() {
  const { user, shopId, shopName, signOut, updateShopName } = useAuth()

  const [mode, setMode] = useState<AppMode>('register')
  const [taxMode, setTaxMode] = useState<TaxMode>('dine-in')
  const [showTaxDeepDive, setShowTaxDeepDive] = useState(false)

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
  const [newStockQuantity, setNewStockQuantity] = useState('')
  const [newStockAlertThreshold, setNewStockAlertThreshold] = useState('')

  const [showShopNameModal, setShowShopNameModal] = useState(false)
  const [shopNameInput, setShopNameInput] = useState('')
  const [skipShopNamePrompt, setSkipShopNamePrompt] = useState(false)

  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [isExpenseLoading, setIsExpenseLoading] = useState(false)
  const [isSavingExpense, setIsSavingExpense] = useState(false)
  const [expenseDate, setExpenseDate] = useState<string>(() => toDateInputValue(new Date()))
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseDescription, setExpenseDescription] = useState('')
  const [expenseReceiptFile, setExpenseReceiptFile] = useState<File | null>(null)
  const [expenseReceiptPreview, setExpenseReceiptPreview] = useState<string | null>(null)
  const [salesCsvFile, setSalesCsvFile] = useState<File | null>(null)
  const [expensesCsvFile, setExpensesCsvFile] = useState<File | null>(null)
  const [isImportingSalesCsv, setIsImportingSalesCsv] = useState(false)
  const [isImportingExpensesCsv, setIsImportingExpensesCsv] = useState(false)
  const [isReceiptOcrRunning, setIsReceiptOcrRunning] = useState(false)
  const [openingReceiptExpenseId, setOpeningReceiptExpenseId] = useState<string | null>(null)
  const [shifts, setShifts] = useState<StaffShiftRecord[]>([])
  const [isShiftLoading, setIsShiftLoading] = useState(false)
  const [isSavingShift, setIsSavingShift] = useState(false)
  const [shiftDate, setShiftDate] = useState<string>(() => toDateInputValue(new Date()))
  const [shiftStaffName, setShiftStaffName] = useState('')
  const [shiftStartTime, setShiftStartTime] = useState('09:00')
  const [shiftEndTime, setShiftEndTime] = useState('17:00')
  const [shiftHourlyWage, setShiftHourlyWage] = useState('1100')
  const [shiftBreakMinutes, setShiftBreakMinutes] = useState('60')
  const [isSyncingFreeeHr, setIsSyncingFreeeHr] = useState(false)
  const [demandForecast, setDemandForecast] = useState<Array<{ date: string; expectedSales: number; factor: number }> | null>(null)
  const [isForecasting, setIsForecasting] = useState(false)
  const [forecastEventNote, setForecastEventNote] = useState('')

  const [inventoryYear, setInventoryYear] = useState<string>(() => String(new Date().getFullYear()))
  const [inventoryAmount, setInventoryAmount] = useState('')
  const [isSavingInventory, setIsSavingInventory] = useState(false)
  const [setupIssues, setSetupIssues] = useState<SetupIssue[]>([])
  const [isSetupChecking, setIsSetupChecking] = useState(false)
  const [isLedgerTemporarilyDisabled, setIsLedgerTemporarilyDisabled] = useState(false)
  const [freeeStatus, setFreeeStatus] = useState<FreeeStatus | null>(null)
  const [isLoadingFreeeStatus, setIsLoadingFreeeStatus] = useState(false)
  const [freeeCompanies, setFreeeCompanies] = useState<FreeeCompany[]>([])
  const [freeeSelectedCompanyId, setFreeeSelectedCompanyId] = useState<number | null>(null)
  const [isLoadingFreeeCompanies, setIsLoadingFreeeCompanies] = useState(false)
  const [freeeAccountItems, setFreeeAccountItems] = useState<FreeeAccountItem[]>([])
  const [freeeSelectedAccountItemId, setFreeeSelectedAccountItemId] = useState<number | null>(null)
  const [isLoadingFreeeAccountItems, setIsLoadingFreeeAccountItems] = useState(false)
  const [freeeTaxes, setFreeeTaxes] = useState<FreeeTax[]>([])
  const [freeeSelectedTaxCode, setFreeeSelectedTaxCode] = useState<number | null>(null)
  const [isLoadingFreeeTaxes, setIsLoadingFreeeTaxes] = useState(false)
  const [isSendingFreeeDeals, setIsSendingFreeeDeals] = useState(false)
  const [freeeLastSendSummary, setFreeeLastSendSummary] = useState<FreeeSendSummary | null>(null)
  const [showAllFreeeTaxes, setShowAllFreeeTaxes] = useState(false)
  const [isAutopilotRunning, setIsAutopilotRunning] = useState(false)
  const [hasAutoInitializedTaxMode, setHasAutoInitializedTaxMode] = useState(false)
  const [aiClassifiedExpenses, setAiClassifiedExpenses] = useState<ClassifiedExpense[] | null>(null)
  const [isAiClassifying, setIsAiClassifying] = useState(false)
  const [showAdvancedExports, setShowAdvancedExports] = useState(false)

  const currentTaxRate = TAX_RATE_BY_MODE[taxMode]
  const uuidShopId = useMemo(() => (shopId ? toDeterministicUuid(shopId) : null), [shopId])
  const activeShopId = useMemo(() => uuidShopId ?? shopId, [shopId, uuidShopId])
  const isLedgerFeatureEnabled =
    (process.env.NEXT_PUBLIC_ENABLE_LEDGER ?? '1') !== '0' && !isLedgerTemporarilyDisabled

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
  const periodExpenseTotal = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  )
  const inventoryAdjustmentAmount = useMemo(() => {
    const amount = Number(inventoryAmount)
    if (!Number.isFinite(amount) || amount < 0) return 0
    return Math.floor(amount)
  }, [inventoryAmount])
  const periodProfit = useMemo(
    () => periodSummary.grossSales - periodExpenseTotal - inventoryAdjustmentAmount,
    [periodSummary.grossSales, periodExpenseTotal, inventoryAdjustmentAmount]
  )
  const shiftLaborTotal = useMemo(
    () =>
      shifts.reduce((sum, shift) => {
        const hours = toShiftHours(shift.start_time, shift.end_time, shift.break_minutes)
        return sum + Math.floor(hours * shift.hourly_wage)
      }, 0),
    [shifts]
  )
  const classifiedExpenses = useMemo<ClassifiedExpense[]>(() => {
    const base = classifyExpenses(expenses)
    if (!aiClassifiedExpenses || aiClassifiedExpenses.length === 0) return base

    const aiMap = new Map(aiClassifiedExpenses.map((item) => [item.expenseId, item]))
    return base.map((item) => aiMap.get(item.expenseId) ?? item)
  }, [aiClassifiedExpenses, expenses])
  const expenseClassificationMap = useMemo(() => {
    return new Map(classifiedExpenses.map((item) => [item.expenseId, item]))
  }, [classifiedExpenses])
  const expenseClassificationSummary = useMemo(
    () => summarizeClassifiedExpenses(classifiedExpenses, 0.1),
    [classifiedExpenses]
  )
  const filingReadiness = useMemo<FilingReadiness>(
    () =>
      buildFilingReadiness({
        startDate,
        endDate,
        salesCount: periodSummary.transactionCount,
        salesGross: periodSummary.grossSales,
        expenseCount: expenses.length,
        expenseTotal: periodExpenseTotal,
        inventoryAmount: inventoryAdjustmentAmount,
        classificationSummary: expenseClassificationSummary,
        classifiedExpenses,
      }),
    [
      classifiedExpenses,
      endDate,
      expenseClassificationSummary,
      expenses.length,
      inventoryAdjustmentAmount,
      periodExpenseTotal,
      periodSummary.grossSales,
      periodSummary.transactionCount,
      startDate,
    ]
  )
  const exportBlockerMessage = useMemo(() => {
    const blockers = filingReadiness.items.filter((item) => item.status === 'BLOCKER')
    if (blockers.length === 0) return ''
    return blockers.map((item) => `${item.title}: ${item.reason}`).join(' / ')
  }, [filingReadiness.items])
  const isExportBlocked = filingReadiness.exportBlocked
  const workflowSteps = useMemo(
    () => [
      {
        id: 'collect',
        label: '1. 集計',
        status: periodSummary.transactionCount > 0 ? 'done' : 'pending',
      },
      {
        id: 'classify',
        label: '2. 判定',
        status:
          expenseClassificationSummary.total > 0 &&
          expenseClassificationSummary.ngCount === 0 &&
          expenseClassificationSummary.reviewCount <= expenseClassificationSummary.maxReviewAllowed
            ? 'done'
            : expenseClassificationSummary.total > 0
              ? 'review'
              : 'pending',
      },
      {
        id: 'export',
        label: '3. 出力',
        status: isExportBlocked ? 'blocked' : 'ready',
      },
    ],
    [expenseClassificationSummary, isExportBlocked, periodSummary.transactionCount]
  )

  const logAuditEvent = useCallback(
    async (eventType: string, resourceType: string, resourceId?: string, metadata?: Record<string, unknown>) => {
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventType, resourceType, resourceId, metadata }),
        })
      } catch {
        // audit failure should not block main workflow
      }
    },
    []
  )

  const visibleFreeeTaxes = useMemo(() => {
    if (showAllFreeeTaxes) return freeeTaxes
    const recommendedKeywords = ['課税仕入', '課税売上', '非課税', '不課税', '免税', '対象外']
    const recommended = freeeTaxes.filter((tax) => {
      const label = formatFreeeTaxLabel(tax)
      return recommendedKeywords.some((k) => label.includes(k))
    })
    return recommended.length > 0 ? recommended : freeeTaxes
  }, [freeeTaxes, showAllFreeeTaxes])

  const queryPeriodExpenses = useCallback(async (
    range?: { startDate: string; endDate: string }
  ): Promise<
    | { ok: true; expenses: ExpenseRecord[] }
    | { ok: false; kind: 'no_shop' | 'invalid_period' | 'missing_table' | 'error'; message?: string }
  > => {
    if (!activeShopId) return { ok: false, kind: 'no_shop' }
    const targetStartDate = range?.startDate ?? startDate
    const targetEndDate = range?.endDate ?? endDate

    if (!targetStartDate || !targetEndDate || targetStartDate > targetEndDate) {
      return { ok: false, kind: 'invalid_period' }
    }

    const { data, error } = await supabase
      .from('expenses')
      .select('id, shop_id, expense_date, amount, description, receipt_url, created_at')
      .eq('shop_id', activeShopId)
      .gte('expense_date', targetStartDate)
      .lte('expense_date', targetEndDate)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      if (isMissingTableError(error)) {
        return { ok: false, kind: 'missing_table' }
      }
      return { ok: false, kind: 'error', message: error.message }
    }

    return { ok: true, expenses: sanitizeExpenses((data ?? []) as unknown[]) }
  }, [activeShopId, endDate, startDate])

  const fetchFreeeStatus = useCallback(async () => {
    setIsLoadingFreeeStatus(true)

    try {
      const response = await fetch('/api/freee/status', { cache: 'no-store' })
      const data = (await response.json()) as FreeeStatus
      setFreeeStatus(data)
    } catch (error) {
      setFreeeStatus({
        configured: false,
        connected: false,
        companyId: null,
        hasRefreshToken: false,
        message: `freee状態の取得に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setIsLoadingFreeeStatus(false)
    }
  }, [])

  const fetchFreeeCompanies = useCallback(async () => {
    setIsLoadingFreeeCompanies(true)
    try {
      const response = await fetch('/api/freee/companies', { cache: 'no-store' })
      const data = (await response.json()) as FreeeCompaniesResult
      setFreeeCompanies(Array.isArray(data.companies) ? data.companies : [])
      setFreeeSelectedCompanyId(data.selectedCompanyId ?? null)
    } catch (error) {
      setNotice({
        type: 'error',
        message: `freee事業所一覧の取得に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setIsLoadingFreeeCompanies(false)
    }
  }, [])

  const setFreeeCompany = useCallback(async (companyId: number) => {
    try {
      const response = await fetch('/api/freee/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      if (!response.ok) {
        setNotice({ type: 'error', message: 'freee事業所の切り替えに失敗しました。' })
        return
      }
      setFreeeSelectedCompanyId(companyId)
      setNotice({ type: 'success', message: 'freee事業所を切り替えました。' })
      await fetchFreeeStatus()
    } catch (error) {
      setNotice({
        type: 'error',
        message: `freee事業所の切り替えに失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    }
  }, [fetchFreeeStatus])

  const fetchFreeeAccountItems = useCallback(async () => {
    setIsLoadingFreeeAccountItems(true)
    try {
      const response = await fetch('/api/freee/account-items', { cache: 'no-store' })
      const data = (await response.json()) as FreeeAccountItemsResult
      const items = Array.isArray(data.accountItems) ? data.accountItems : []
      setFreeeAccountItems(items)

      // それっぽいデフォルトを当てる（雑費/消耗品費/仕入など）
      const preferred = ['雑費', '消耗品', '仕入', '外注費', '通信費', '広告宣伝費']
      const found = items.find((it) => preferred.some((p) => it.name.includes(p)))
      const initialAccountItemId = found?.id ?? (items[0]?.id ?? null)
      setFreeeSelectedAccountItemId((prev) => prev ?? initialAccountItemId)

      // account_item の default_tax_code があるならそれを優先する
      const initialItem = items.find((it) => it.id === (freeeSelectedAccountItemId ?? initialAccountItemId))
      if (initialItem?.default_tax_code) {
        setFreeeSelectedTaxCode((prev) => prev ?? initialItem.default_tax_code ?? null)
      }
    } catch (error) {
      setNotice({
        type: 'error',
        message: `freee勘定科目の取得に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setIsLoadingFreeeAccountItems(false)
    }
  }, [])

  const fetchFreeeTaxes = useCallback(async () => {
    setIsLoadingFreeeTaxes(true)
    try {
      // まずは使用可能な税区分だけ取得（display_category指定は後で絞り込む）
      const response = await fetch('/api/freee/taxes?available=true', { cache: 'no-store' })
      const data = (await response.json()) as FreeeTaxesResult
      const taxes = Array.isArray(data.taxes) ? data.taxes : []
      setFreeeTaxes(taxes)

      if (!response.ok) {
        setNotice({
          type: 'error',
          message: `freee税区分の取得に失敗しました（HTTP ${response.status}）。`,
        })
        return
      }

      if (taxes.length === 0) {
        setNotice({
          type: 'error',
          message:
            data.hint ??
            'freee税区分が0件です。freeeの事業所設定または権限（scope/契約）を確認してください。',
        })
        return
      }

      // それっぽいデフォルト（課対仕入10% / 課税仕入10% 系）を探す
      const preferredRaw = ['purchase_with_tax_10', 'purchase_without_tax_10', 'purchase_with_tax_8', 'purchase_without_tax_8']
      const found =
        taxes.find((t) => preferredRaw.includes(String(t.name ?? '').trim())) ??
        taxes.find((t) => {
          const label = formatFreeeTaxLabel(t)
          return label.includes('課税仕入') && (label.includes('10%') || label.includes('10'))
        }) ??
        taxes.find((t) => formatFreeeTaxLabel(t).includes('課税仕入')) ??
        taxes[0]

      setFreeeSelectedTaxCode((prev) => prev ?? found?.code ?? (taxes[0]?.code ?? null))
    } catch (error) {
      setNotice({
        type: 'error',
        message: `freee税区分の取得に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setIsLoadingFreeeTaxes(false)
    }
  }, [])

  const sendExpensesToFreeeDeals = useCallback(
    async (limit: number) => {
      if (isExportBlocked) {
        setNotice({
          type: 'error',
          message: `要確認 ${expenseClassificationSummary.reviewCount} 件 / NG ${expenseClassificationSummary.ngCount} 件を解消してから送信してください。`,
        })
        return
      }

      if (!freeeStatus?.connected || !freeeStatus.companyId) {
        setNotice({ type: 'error', message: 'freeeが未接続です。先に接続してください。' })
        return
      }
      if (!freeeSelectedAccountItemId) {
        setNotice({ type: 'error', message: 'freeeの勘定科目を選択してください。' })
        return
      }
      if (!freeeSelectedTaxCode) {
        setNotice({ type: 'error', message: 'freeeの税区分（tax code）を選択してください。' })
        return
      }

      const result = await queryPeriodExpenses()
      if (result.ok) {
        setExpenses(result.expenses)
      }

      if (!result.ok && result.kind === 'missing_table') {
        setNotice({
          type: 'error',
          message: '経費帳テーブルが未作成です（Supabaseに expenses を作成してください）。',
        })
        return
      }

      if (!result.ok && result.kind === 'error') {
        setNotice({ type: 'error', message: `経費取得に失敗しました: ${result.message}` })
        return
      }

      const sourceExpenses = result.ok ? result.expenses : expenses
      const sourceClassifications = classifyExpenses(sourceExpenses)
      const exportableExpenses = sourceExpenses.filter((expense) => {
        const c = sourceClassifications.find((item) => item.expenseId === expense.id)
        return c?.rank === 'OK'
      })
      if (exportableExpenses.length === 0) {
        setNotice({
          type: 'error',
          message: '送信できる経費がありません（自動判定でOKの経費が0件です）。',
        })
        return
      }

      const target = exportableExpenses.slice(0, Math.max(1, limit))
      const ok = window.confirm(
        `freeeに支出取引（未決済）として ${target.length} 件登録します。\n\nfreee側で最終確認してから確定してください。\n\n続行しますか？`
      )
      if (!ok) return

      setIsSendingFreeeDeals(true)
      try {
        const response = await fetch('/api/freee/deals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: freeeStatus.companyId,
            accountItemId: freeeSelectedAccountItemId,
            taxCode: freeeSelectedTaxCode,
            expenses: target.map((exp) => ({
              id: exp.id,
              expense_date: exp.expense_date,
              amount: exp.amount,
              description: exp.description,
              receipt_url: exp.receipt_url,
            })),
          }),
        })

        const data = (await response.json()) as unknown

        const parsed = data as { ok?: boolean; results?: Array<{ ok: boolean; status: number }> }
        if (!response.ok) {
          setNotice({ type: 'error', message: `freee送信に失敗しました（HTTP ${response.status}）` })
          return
        }

        const results = Array.isArray(parsed.results) ? parsed.results : []
        const success = results.filter((r) => r.ok).length
        const failed = results.length - success
        setFreeeLastSendSummary({
          success,
          failed,
          total: results.length,
          lastRunAt: new Date().toISOString(),
        })
        setNotice({
          type: failed === 0 ? 'success' : 'error',
          message:
            failed === 0
              ? `freeeに ${success} 件登録しました（未決済の支出取引）。`
              : `freee送信: 成功 ${success} 件 / 失敗 ${failed} 件`,
        })
      } catch (error) {
        setNotice({
          type: 'error',
          message: `freee送信に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        })
      } finally {
        setIsSendingFreeeDeals(false)
      }
    },
    [
      expenseClassificationSummary.ngCount,
      expenseClassificationSummary.reviewCount,
      expenses,
      freeeSelectedAccountItemId,
      freeeSelectedTaxCode,
      freeeStatus?.companyId,
      freeeStatus?.connected,
      isExportBlocked,
    ]
  )

  const fetchMenuItems = useCallback(async () => {
    if (!shopId) return

    let { data, error } = await supabase
      .from('menu_items')
      .select(
        'id, name, price, tax_rate, image_url, shop_id, only_takeout, only_eat_in, stock_quantity, stock_alert_threshold'
      )
      .eq('shop_id', shopId)
      .order('name', { ascending: true })

    if (isInvalidUuidError(error) && uuidShopId) {
      const retry = await supabase
        .from('menu_items')
        .select(
          'id, name, price, tax_rate, image_url, shop_id, only_takeout, only_eat_in, stock_quantity, stock_alert_threshold'
        )
        .eq('shop_id', uuidShopId)
        .order('name', { ascending: true })
      data = retry.data
      error = retry.error
    }

    if (!error) {
      setMenuItems(sanitizeMenuItems((data ?? []) as unknown[]))
      return
    }

    // Legacy schema fallback (README 初期版): shop_id / tax_rate / only_* が無い場合
    if (
      isMissingColumnError(error, 'shop_id') ||
      isMissingColumnError(error, 'tax_rate') ||
      isMissingColumnError(error, 'only_takeout') ||
      isMissingColumnError(error, 'only_eat_in') ||
      isMissingColumnError(error, 'stock_quantity') ||
      isMissingColumnError(error, 'stock_alert_threshold')
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

    let { data, error } = await supabase
      .from('sales')
      .select('id, items, total_amount, created_at, shop_id, tax_details')
      .eq('shop_id', shopId)
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`)
      .order('created_at', { ascending: false })

    if (isInvalidUuidError(error) && uuidShopId) {
      const retry = await supabase
        .from('sales')
        .select('id, items, total_amount, created_at, shop_id, tax_details')
        .eq('shop_id', uuidShopId)
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`)
        .order('created_at', { ascending: false })
      data = retry.data
      error = retry.error
    }

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
  }, [shopId, uuidShopId])

  const runSetupChecks = useCallback(async () => {
    if (!activeShopId) return

    setIsSetupChecking(true)
    const issues: SetupIssue[] = []

    const tableChecks: Array<{ table: string; select: string }> = [
      { table: 'shops', select: 'id' },
      { table: 'menu_items', select: 'id' },
      { table: 'sales', select: 'id' },
      { table: 'expenses', select: 'id' },
      { table: 'inventory_adjustments', select: 'id' },
      { table: 'staff_shifts', select: 'id' },
      { table: 'audit_logs', select: 'id' },
    ]

    for (const check of tableChecks) {
      const { error } = await supabase.from(check.table).select(check.select).limit(1)
      if (!error) continue

      if (isMissingTableError(error)) {
        issues.push({
          id: `missing-table-${check.table}`,
          title: `テーブル不足: ${check.table}`,
          detail: `Supabaseに ${check.table} テーブルがありません。下のSQLを実行してください。`,
          actionLabel: 'SQLを実行',
          actionBody: LEDGER_SETUP_SQL,
        })
        continue
      }

      if (error.code === '42501') {
        if (check.table === 'audit_logs') {
          continue
        }
        issues.push({
          id: `policy-${check.table}`,
          title: `権限不足: ${check.table}`,
          detail:
            `テーブル ${check.table} へのアクセス権限が不足しています。RLSポリシーまたはロール権限を確認してください。`,
          actionLabel: 'RLSを確認',
          actionBody: `-- 例: policy確認\nselect * from pg_policies where tablename = '${check.table}';`,
        })
      }
    }

    const bucketCheck = await supabase.storage.from('expense-receipts').list(activeShopId, { limit: 1 })
    if (bucketCheck.error) {
      const message = bucketCheck.error.message.toLowerCase()
      if (message.includes('bucket') && message.includes('not')) {
        issues.push({
          id: 'missing-bucket-expense-receipts',
          title: 'レシート保存バケット不足',
          detail: 'storage bucket `expense-receipts` が未作成です。SQLで作成してください。',
          actionLabel: 'Bucket作成SQL',
          actionBody: EXPENSE_BUCKET_SETUP_SQL,
        })
      } else if (bucketCheck.error.statusCode === '403') {
        // 非公開バケットで403になるのは想定内。公開アクセス不要。
      } else {
        issues.push({
          id: 'bucket-policy-expense-receipts',
          title: 'レシート保存設定を確認',
          detail:
            'expense-receipts へのアクセス確認に失敗しました。非公開バケット運用のため、サーバーAPIとservice roleの設定を確認してください。',
          actionLabel: 'Bucket設定SQL',
          actionBody: EXPENSE_BUCKET_SETUP_SQL,
        })
      }
    }

    const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ''
    if (clerkPublishableKey.startsWith('pk_test_')) {
      issues.push({
        id: 'clerk-dev-key',
        title: 'Clerkが開発キーのままです',
        detail: '本番利用制限があるため、Vercelの環境変数を本番キーへ差し替えてください。',
        actionLabel: '必要なキー',
        actionBody:
          'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<pk_live_...>\nCLERK_SECRET_KEY=<sk_live_...>',
      })
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      issues.push({
        id: 'missing-supabase-service-role',
        title: 'SUPABASE_SERVICE_ROLE_KEY が未設定です',
        detail:
          'レシートを非公開で運用するには、サーバーAPI経由アップロード用の service role key が必要です。',
        actionLabel: '環境変数を追加',
        actionBody: 'SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>',
      })
    }

    if ((process.env.ENABLE_EXTERNAL_LLM ?? '0') === '1') {
      issues.push({
        id: 'external-llm-enabled',
        title: '外部LLM送信が有効です',
        detail:
          '説明文をマスクして送信していますが、厳格運用では ENABLE_EXTERNAL_LLM=0（ローカルモデルのみ）を推奨します。',
        actionLabel: '厳格設定',
        actionBody: 'ENABLE_EXTERNAL_LLM=0',
      })
    }

    if ((process.env.ENABLE_RECEIPT_OCR ?? '0') !== '1') {
      issues.push({
        id: 'receipt-ocr-disabled',
        title: 'レシートOCRは無効です',
        detail:
          '画像を外部送信したくない安全設定です。必要な場合だけ ENABLE_RECEIPT_OCR=1 で有効化してください。',
        actionLabel: '必要時のみ有効化',
        actionBody: 'ENABLE_RECEIPT_OCR=1',
      })
    }

    // freee 連携は店主ワンタップ体験の範囲外なので、導入チェック対象から除外する。

    setSetupIssues(issues)
    setIsSetupChecking(false)
  }, [activeShopId])

  const fetchPeriodExpenses = useCallback(async () => {
    setIsExpenseLoading(true)
    try {
      const result = await queryPeriodExpenses()

      if (!result.ok) {
        if (result.kind === 'missing_table') {
          setExpenses([])
          setAiClassifiedExpenses(null)
          setNotice({
            type: 'error',
            message:
              '経費帳テーブルが未作成です。Supabaseに expenses / inventory_adjustments を作成してください。',
          })
          return
        }
        if (result.kind === 'error') {
          setNotice({ type: 'error', message: `経費取得に失敗しました: ${result.message}` })
        }
        return
      }

      setAiClassifiedExpenses(null)
      setExpenses(result.expenses)
    } finally {
      setIsExpenseLoading(false)
    }
  }, [queryPeriodExpenses])

  const fetchInventoryAdjustment = useCallback(async (targetYear?: string): Promise<number | null> => {
    if (!activeShopId) return null

    const parsedYear = Number(targetYear ?? inventoryYear)
    if (!Number.isInteger(parsedYear)) return null

    const { data, error } = await supabase
      .from('inventory_adjustments')
      .select('id, shop_id, fiscal_year, amount')
      .eq('shop_id', activeShopId)
      .eq('fiscal_year', parsedYear)
      .maybeSingle()

    if (error) {
      if (isMissingTableError(error)) {
        setInventoryAmount('')
        return 0
      }
      setNotice({ type: 'error', message: `在庫調整額の取得に失敗しました: ${error.message}` })
      return null
    }

    const record = data as InventoryAdjustmentRecord | null
    setInventoryAmount(record ? String(record.amount) : '')
    return record?.amount ?? 0
  }, [activeShopId, inventoryYear])

  const fetchShifts = useCallback(async () => {
    if (!activeShopId || !startDate || !endDate) return
    setIsShiftLoading(true)
    try {
      const { data, error } = await supabase
        .from('staff_shifts')
        .select('id, shop_id, shift_date, staff_name, start_time, end_time, hourly_wage, break_minutes, created_at')
        .eq('shop_id', activeShopId)
        .gte('shift_date', startDate)
        .lte('shift_date', endDate)
        .order('shift_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) {
        if (isMissingTableError(error)) {
          setShifts([])
          return
        }
        setNotice({ type: 'error', message: `シフト取得に失敗しました: ${error.message}` })
        return
      }
      setShifts(sanitizeShifts((data ?? []) as unknown[]))
    } finally {
      setIsShiftLoading(false)
    }
  }, [activeShopId, endDate, startDate])

  const handleSaveShift = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!shopId) return

    const ensuredShopId = await ensureShopRecord()
    if (!ensuredShopId) return

    const staffName = shiftStaffName.trim()
    const hourlyWage = Number(shiftHourlyWage)
    const breakMinutes = Number(shiftBreakMinutes)
    if (!shiftDate || !staffName || !shiftStartTime || !shiftEndTime) {
      setNotice({ type: 'error', message: 'シフトの必須項目を入力してください。' })
      return
    }
    if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
      setNotice({ type: 'error', message: '時給は0以上で入力してください。' })
      return
    }
    if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
      setNotice({ type: 'error', message: '休憩分は0以上で入力してください。' })
      return
    }

    setIsSavingShift(true)
    setNotice(null)
    const { error } = await supabase.from('staff_shifts').insert({
      shop_id: ensuredShopId,
      shift_date: shiftDate,
      staff_name: staffName,
      start_time: shiftStartTime,
      end_time: shiftEndTime,
      hourly_wage: Math.floor(hourlyWage),
      break_minutes: Math.floor(breakMinutes),
    })
    setIsSavingShift(false)

    if (error) {
      if (isMissingTableError(error)) {
        setNotice({
          type: 'error',
          message: 'staff_shifts テーブルが未作成です。導入チェックのSQLを再実行してください。',
        })
        return
      }
      setNotice({ type: 'error', message: `シフト保存に失敗しました: ${error.message}` })
      return
    }

    setShiftStaffName('')
    await fetchShifts()
    setNotice({ type: 'success', message: 'シフトを保存しました。' })
    void logAuditEvent('shift_saved', 'staff_shift', undefined, { shiftDate })
  }

  const syncShiftsToFreeeHr = async () => {
    if (shifts.length === 0) {
      setNotice({ type: 'error', message: '同期対象のシフトがありません。' })
      return
    }
    setIsSyncingFreeeHr(true)
    try {
      const response = await fetch('/api/freee/hr/sync-shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shifts }),
      })
      const data = (await response.json()) as { ok?: boolean; message?: string; error?: string; count?: number }
      if (!response.ok || !data.ok) {
        setNotice({ type: 'error', message: data.error ?? 'freee人事労務への同期に失敗しました。' })
        return
      }
      setNotice({
        type: 'success',
        message: data.message ?? `freee人事労務に ${data.count ?? shifts.length} 件のシフトを同期しました。`,
      })
      void logAuditEvent('freee_hr_sync', 'staff_shift', undefined, { count: data.count ?? shifts.length })
    } catch (error) {
      setNotice({
        type: 'error',
        message: `freee人事労務への同期に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setIsSyncingFreeeHr(false)
    }
  }

  const fetchPeriodSales = useCallback(async (
    range?: { startDate: string; endDate: string }
  ): Promise<{ sales: SaleRecord[]; expenses: ExpenseRecord[] } | null> => {
    if (!shopId) return null
    const targetStartDate = range?.startDate ?? startDate
    const targetEndDate = range?.endDate ?? endDate

    if (!targetStartDate || !targetEndDate) {
      setNotice({ type: 'error', message: '開始日と終了日を設定してください。' })
      return null
    }

    if (targetStartDate > targetEndDate) {
      setNotice({ type: 'error', message: '終了日は開始日以降にしてください。' })
      return null
    }

    setIsPeriodLoading(true)
    setNotice(null)

    let { data, error } = await supabase
      .from('sales')
      .select('id, items, total_amount, created_at, shop_id, tax_details')
      .eq('shop_id', shopId)
      .gte('created_at', `${targetStartDate}T00:00:00`)
      .lte('created_at', `${targetEndDate}T23:59:59`)
      .order('created_at', { ascending: false })

    if (isInvalidUuidError(error) && uuidShopId) {
      const retry = await supabase
        .from('sales')
        .select('id, items, total_amount, created_at, shop_id, tax_details')
        .eq('shop_id', uuidShopId)
        .gte('created_at', `${targetStartDate}T00:00:00`)
        .lte('created_at', `${targetEndDate}T23:59:59`)
        .order('created_at', { ascending: false })
      data = retry.data
      error = retry.error
    }

    setIsPeriodLoading(false)

    if (!error) {
      const normalizedSales = sanitizeSales((data ?? []) as unknown[])
      setPeriodSales(normalizedSales)
      const expensesResult = await queryPeriodExpenses({
        startDate: targetStartDate,
        endDate: targetEndDate,
      })
      if (expensesResult.ok) {
        setAiClassifiedExpenses(null)
        setExpenses(expensesResult.expenses)
        return { sales: normalizedSales, expenses: expensesResult.expenses }
      }
      return { sales: normalizedSales, expenses: [] }
    }

    if (isMissingColumnError(error, 'shop_id') || isMissingColumnError(error, 'tax_details')) {
      const { data: legacyData, error: legacyError } = await supabase
        .from('sales')
        .select('id, items, total_amount, created_at')
        .gte('created_at', `${targetStartDate}T00:00:00`)
        .lte('created_at', `${targetEndDate}T23:59:59`)
        .order('created_at', { ascending: false })

      if (legacyError) {
        setNotice({ type: 'error', message: `期間売上取得に失敗しました: ${legacyError.message}` })
        return null
      }

      const normalizedSales = sanitizeSales((legacyData ?? []) as unknown[])
      setPeriodSales(normalizedSales)
      const expensesResult = await queryPeriodExpenses({
        startDate: targetStartDate,
        endDate: targetEndDate,
      })
      if (expensesResult.ok) {
        setAiClassifiedExpenses(null)
        setExpenses(expensesResult.expenses)
        return { sales: normalizedSales, expenses: expensesResult.expenses }
      }
      return { sales: normalizedSales, expenses: [] }
    }

    if (error) {
      setNotice({ type: 'error', message: `期間売上取得に失敗しました: ${error.message}` })
      return null
    }
    return null
  }, [endDate, shopId, startDate, uuidShopId, queryPeriodExpenses])

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

  useEffect(() => {
    if (!shopId || isInitialLoading) return
    void runSetupChecks()
  }, [shopId, isInitialLoading, runSetupChecks])

  useEffect(() => {
    setHasAutoInitializedTaxMode(false)
  }, [shopId])

  useEffect(() => {
    // Keep deep-dive panel scoped to the current view.
    if (mode !== 'tax') setShowTaxDeepDive(false)
  }, [mode])

  useEffect(() => {
    if (mode !== 'tax') return
    void runSetupChecks()
  }, [mode, runSetupChecks])

  useEffect(() => {
    if (mode !== 'tax') return
    void fetchPeriodExpenses()
  }, [mode, fetchPeriodExpenses])

  useEffect(() => {
    if (mode !== 'tax') return
    void fetchInventoryAdjustment()
  }, [mode, fetchInventoryAdjustment])

  useEffect(() => {
    if (mode !== 'tax') return
    void fetchShifts()
  }, [mode, fetchShifts])

  useEffect(() => {
    if (mode !== 'tax') return
    const yearFromPeriod = endDate.slice(0, 4)
    if (/^\d{4}$/.test(yearFromPeriod) && yearFromPeriod !== inventoryYear) {
      setInventoryYear(yearFromPeriod)
    }
  }, [endDate, inventoryYear, mode])

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

  const ensureShopRecord = useCallback(async (): Promise<string | null> => {
    if (!activeShopId) return null

    const fallbackShopName = shopName?.trim() || user?.email?.split('@')[0] || '店舗'
    const { error } = await supabase
      .from('shops')
      .upsert({ id: activeShopId, name: fallbackShopName }, { onConflict: 'id' })

    if (error) {
      setNotice({ type: 'error', message: `店舗情報の初期化に失敗しました: ${error.message}` })
      return null
    }

    return activeShopId
  }, [activeShopId, shopName, user?.email])

  const handleCheckout = async () => {
    if (!shopId || cartSaleItems.length === 0) return

    setIsSavingOrder(true)
    setNotice(null)

    const ensuredShopId = await ensureShopRecord()
    if (!ensuredShopId) {
      setIsSavingOrder(false)
      return
    }

    const payload = {
      shop_id: ensuredShopId,
      items: cartSaleItems,
      total_amount: cartSummary.grossSales,
      tax_details: toTaxDetails(cartSaleItems),
    }

    let { error } = await supabase.from('sales').insert(payload)

    if (isInvalidUuidError(error) && uuidShopId) {
      const retryWithUuid = await supabase.from('sales').insert({
        ...payload,
        shop_id: uuidShopId,
      })
      error = retryWithUuid.error
    }

    if (error && (isMissingColumnError(error, 'shop_id') || isMissingColumnError(error, 'tax_details'))) {
      const legacyPayload = {
        shop_id: ensuredShopId,
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
    await adjustInventoryBySale(cartSaleItems)
    await fetchTodaySales()
    setNotice({
      type: 'success',
      message: `会計を記帳しました（${formatYen(cartSummary.grossSales)} / ${cartSummary.itemCount}点）`,
    })
  }

  const adjustInventoryBySale = async (saleItems: SaleItem[]) => {
    const targets = saleItems
      .map((item) => {
        const menu = menuItems.find((m) => m.id === item.id)
        if (!menu || menu.stock_quantity == null) return null
        return {
          id: menu.id,
          nextStock: Math.max(0, menu.stock_quantity - item.quantity),
        }
      })
      .filter((x): x is { id: number; nextStock: number } => Boolean(x))

    if (targets.length === 0) return

    for (const target of targets) {
      const { error } = await supabase.from('menu_items').update({ stock_quantity: target.nextStock }).eq('id', target.id)
      if (error && !isMissingColumnError(error, 'stock_quantity')) {
        setNotice({ type: 'error', message: `在庫更新に失敗しました: ${error.message}` })
        return
      }
    }

    await fetchMenuItems()
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

  const adjustSingleItemStock = async (id: number, delta: number) => {
    const target = menuItems.find((item) => item.id === id)
    if (!target || target.stock_quantity == null) return

    const next = Math.max(0, target.stock_quantity + delta)
    const { error } = await supabase.from('menu_items').update({ stock_quantity: next }).eq('id', id)
    if (error) {
      if (isMissingColumnError(error, 'stock_quantity')) {
        setNotice({ type: 'error', message: '在庫カラムが未作成です。導入SQLを再実行してください。' })
        return
      }
      setNotice({ type: 'error', message: `在庫更新に失敗しました: ${error.message}` })
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
    if (!activeShopId) return null

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
    const fileName = `${activeShopId}/${Date.now()}.${extension}`

    const { error } = await supabase.storage.from('product-images').upload(fileName, file)
    if (error) {
      return null
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('product-images').getPublicUrl(fileName)

    return publicUrl
  }

  const handleExpenseReceiptChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setExpenseReceiptFile(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      setExpenseReceiptPreview(typeof reader.result === 'string' ? reader.result : null)
    }
    reader.readAsDataURL(file)
  }

  const uploadExpenseReceipt = async (file: File): Promise<string | null> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('expenseDate', expenseDate)

    const response = await fetch('/api/receipts/upload', {
      method: 'POST',
      body: formData,
    })
    const data = (await response.json()) as ReceiptUploadApiResponse
    if (!response.ok || !data.ok || !data.filePath) return null
    return data.filePath
  }

  const openExpenseReceipt = async (expenseId: string, receiptRef: string) => {
    const trimmed = receiptRef.trim()
    if (!trimmed) return

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      window.open(trimmed, '_blank', 'noopener,noreferrer')
      return
    }

    setOpeningReceiptExpenseId(expenseId)
    try {
      const response = await fetch('/api/receipts/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: trimmed }),
      })
      const data = (await response.json()) as ReceiptSignedUrlApiResponse
      if (!response.ok || !data.ok || !data.signedUrl) {
        setNotice({ type: 'error', message: data.error ?? 'レシートURLの生成に失敗しました。' })
        return
      }
      void logAuditEvent('receipt_view_signed_url', 'expense_receipt', expenseId, {
        hasSignedUrl: true,
      })
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setNotice({
        type: 'error',
        message: `レシート表示に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setOpeningReceiptExpenseId(null)
    }
  }

  const importSalesCsv = async () => {
    if (!salesCsvFile || !shopId) {
      setNotice({ type: 'error', message: '売上CSVファイルを選択してください。' })
      return
    }

    const ensuredShopId = await ensureShopRecord()
    if (!ensuredShopId) return

    setIsImportingSalesCsv(true)
    setNotice(null)

    try {
      const text = await salesCsvFile.text()
      const rows = parseCsvRows(text)
      if (rows.length < 2) {
        setNotice({ type: 'error', message: '売上CSVに有効なデータ行がありません。' })
        return
      }

      const headers = rows[0].map(normalizeHeader)
      const amountIdx = findHeaderIndex(headers, ['税込売上', 'totalamount', 'amount', '売上'])
      const dateIdx = findHeaderIndex(headers, ['日時', '日付', 'createdat', 'date'])
      const taxRateIdx = findHeaderIndex(headers, ['税率', 'taxrate', 'rate'])
      const itemIdx = findHeaderIndex(headers, ['商品明細', '商品', 'items', 'item'])

      if (amountIdx < 0 || dateIdx < 0) {
        setNotice({ type: 'error', message: '売上CSVの列を認識できません。必須: 日付/日時, 金額。' })
        return
      }

      const payload = rows.slice(1).flatMap((row) => {
        const amount = parseAmount(row[amountIdx] ?? '')
        const date = parseDateYmd(row[dateIdx] ?? '')
        if (!Number.isFinite(amount) || amount <= 0 || !date) return []
        const rateRaw = Number((row[taxRateIdx] ?? '10').replace('%', '').trim())
        const taxRate = normalizeTaxRate(Number.isFinite(rateRaw) ? rateRaw : 10)
        const subtotal = Math.floor((amount * 100) / (100 + taxRate))
        const taxAmount = amount - subtotal
        const itemName = (row[itemIdx] ?? '').trim() || '売上取込'
        const items: SaleItem[] = [{ id: 0, name: itemName, price: subtotal, quantity: 1, tax_rate: taxRate }]
        return [
          {
            shop_id: ensuredShopId,
            items,
            total_amount: amount,
            created_at: `${date}T12:00:00`,
            tax_details: [
              {
                tax_rate: taxRate,
                subtotal,
                tax_amount: taxAmount,
                total: amount,
              },
            ],
          },
        ]
      })

      if (payload.length === 0) {
        setNotice({ type: 'error', message: '売上CSVから取り込める行がありませんでした。' })
        return
      }

      let { error } = await supabase.from('sales').insert(payload)
      if (isInvalidUuidError(error) && uuidShopId) {
        const retry = await supabase.from('sales').insert(payload.map((row) => ({ ...row, shop_id: uuidShopId })))
        error = retry.error
      }
      if (error && (isMissingColumnError(error, 'shop_id') || isMissingColumnError(error, 'tax_details'))) {
        const legacyRows = payload.map((row) => ({
          shop_id: row.shop_id,
          items: row.items,
          total_amount: row.total_amount,
          created_at: row.created_at,
        }))
        const retry = await supabase.from('sales').insert(legacyRows)
        error = retry.error
      }

      if (error) {
        setNotice({ type: 'error', message: `売上CSV取込に失敗しました: ${error.message}` })
        return
      }

      setSalesCsvFile(null)
      await fetchTodaySales()
      await fetchPeriodSales()
      void logAuditEvent('sales_csv_import', 'sales', undefined, { importedCount: payload.length })
      setNotice({ type: 'success', message: `売上CSVを ${payload.length} 件取り込みました。` })
    } finally {
      setIsImportingSalesCsv(false)
    }
  }

  const importExpensesCsv = async () => {
    if (!expensesCsvFile || !shopId) {
      setNotice({ type: 'error', message: '経費CSVファイルを選択してください。' })
      return
    }

    const ensuredShopId = await ensureShopRecord()
    if (!ensuredShopId) return

    setIsImportingExpensesCsv(true)
    setNotice(null)

    try {
      const text = await expensesCsvFile.text()
      const rows = parseCsvRows(text)
      if (rows.length < 2) {
        setNotice({ type: 'error', message: '経費CSVに有効なデータ行がありません。' })
        return
      }

      const headers = rows[0].map(normalizeHeader)
      const amountIdx = findHeaderIndex(headers, ['金額', 'amount'])
      const dateIdx = findHeaderIndex(headers, ['日付', 'date'])
      const descIdx = findHeaderIndex(headers, ['内容', '摘要', 'description', 'item', '取引先'])
      const receiptIdx = findHeaderIndex(headers, ['レシートurl', 'receipturl', 'receipt'])

      if (amountIdx < 0 || dateIdx < 0 || descIdx < 0) {
        setNotice({ type: 'error', message: '経費CSVの列を認識できません。必須: 日付, 金額, 内容。' })
        return
      }

      const payload = rows.slice(1).flatMap((row) => {
        const amount = parseAmount(row[amountIdx] ?? '')
        const date = parseDateYmd(row[dateIdx] ?? '')
        const description = String(row[descIdx] ?? '').trim()
        const receiptUrlRaw = String(row[receiptIdx] ?? '').trim()
        const receiptUrl = receiptUrlRaw || null
        if (!date || !description || !Number.isFinite(amount) || amount <= 0) return []
        return [
          {
            shop_id: ensuredShopId,
            expense_date: date,
            amount,
            description,
            receipt_url: receiptUrl,
          },
        ]
      })

      if (payload.length === 0) {
        setNotice({ type: 'error', message: '経費CSVから取り込める行がありませんでした。' })
        return
      }

      const { error } = await supabase.from('expenses').insert(payload)
      if (error) {
        if (isMissingTableError(error)) {
          setNotice({
            type: 'error',
            message: '経費帳テーブルが未作成です。Supabaseに expenses を作成してください。',
          })
          return
        }
        setNotice({ type: 'error', message: `経費CSV取込に失敗しました: ${error.message}` })
        return
      }

      setExpensesCsvFile(null)
      await fetchPeriodExpenses()
      void logAuditEvent('expenses_csv_import', 'expenses', undefined, { importedCount: payload.length })
      setNotice({ type: 'success', message: `経費CSVを ${payload.length} 件取り込みました。` })
    } finally {
      setIsImportingExpensesCsv(false)
    }
  }

  const applyExpenseFromReceiptImage = async () => {
    if (!expenseReceiptFile) {
      setNotice({ type: 'error', message: '先にレシート画像を選択してください。' })
      return
    }

    setIsReceiptOcrRunning(true)
    setNotice(null)
    try {
      const toDataUrl = (file: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result)
            else reject(new Error('failed to read image'))
          }
          reader.onerror = () => reject(new Error('failed to read image'))
          reader.readAsDataURL(file)
        })

      const dataUrl = await toDataUrl(expenseReceiptFile)
      const response = await fetch('/api/tax/ocr-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      })
      const data = (await response.json()) as TaxOcrApiResponse
      if (!response.ok || !data.ok || !data.expense) {
        setNotice({
          type: 'error',
          message: data.error ?? data.message ?? '画像からの抽出に失敗しました。',
        })
        return
      }

      setExpenseDate(data.expense.expense_date)
      setExpenseAmount(String(data.expense.amount))
      setExpenseDescription(data.expense.description)
      setNotice({ type: 'success', message: data.message ?? '画像から経費候補を入力しました。' })
      void logAuditEvent('receipt_ocr_autofill', 'expense_form', undefined, {
        hasMerchant: Boolean(data.expense.merchant),
      })
    } catch (error) {
      setNotice({
        type: 'error',
        message: `画像からの抽出に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setIsReceiptOcrRunning(false)
    }
  }

  const handleExpenseSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!shopId) return

    const ensuredShopId = await ensureShopRecord()
    if (!ensuredShopId) return

    const amount = Number(expenseAmount)
    const description = expenseDescription.trim()

    if (!expenseDate) {
      setNotice({ type: 'error', message: '経費の日付を入力してください。' })
      return
    }
    if (!description) {
      setNotice({ type: 'error', message: '経費内容を入力してください。' })
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ type: 'error', message: '経費金額は1円以上で入力してください。' })
      return
    }

    setIsSavingExpense(true)
    setNotice(null)

    let receiptUrl: string | null = null
    if (expenseReceiptFile) {
      receiptUrl = await uploadExpenseReceipt(expenseReceiptFile)
      if (!receiptUrl) {
        setIsSavingExpense(false)
        setNotice({
          type: 'error',
          message: 'レシート画像のアップロードに失敗しました。サーバー側のStorage設定を確認してください。',
        })
        return
      }
    }

    const { error } = await supabase.from('expenses').insert({
      shop_id: ensuredShopId,
      expense_date: expenseDate,
      amount: Math.floor(amount),
      description,
      receipt_url: receiptUrl,
    })

    setIsSavingExpense(false)

    if (error) {
      if (isMissingTableError(error)) {
        setNotice({
          type: 'error',
          message:
            '経費帳テーブルが未作成です。Supabaseに expenses / inventory_adjustments を作成してください。',
        })
        return
      }
      setNotice({ type: 'error', message: `経費登録に失敗しました: ${error.message}` })
      return
    }

    setExpenseAmount('')
    setExpenseDescription('')
    setExpenseReceiptFile(null)
    setExpenseReceiptPreview(null)
    await fetchPeriodExpenses()
    setNotice({ type: 'success', message: '経費を保存しました。' })
  }

  const deleteExpense = async (expenseId: string) => {
    const shouldDelete = window.confirm('この経費を削除しますか？')
    if (!shouldDelete) return

    const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
    if (error) {
      setNotice({ type: 'error', message: `経費削除に失敗しました: ${error.message}` })
      return
    }

    await fetchPeriodExpenses()
    setNotice({ type: 'success', message: '経費を削除しました。' })
  }

  const handleSaveInventoryAdjustment = async () => {
    if (!shopId) return

    const ensuredShopId = await ensureShopRecord()
    if (!ensuredShopId) return

    const fiscalYear = Number(inventoryYear)
    const amount = Number(inventoryAmount)

    if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 9999) {
      setNotice({ type: 'error', message: '在庫年は4桁の西暦で入力してください。' })
      return
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setNotice({ type: 'error', message: '在庫合計額は0円以上で入力してください。' })
      return
    }

    setIsSavingInventory(true)
    setNotice(null)

    let { error } = await supabase.from('inventory_adjustments').upsert(
      {
        shop_id: ensuredShopId,
        fiscal_year: fiscalYear,
        amount: Math.floor(amount),
      },
      { onConflict: 'shop_id,fiscal_year' }
    )

    if (error && error.code === '42P10') {
      const existing = await supabase
        .from('inventory_adjustments')
        .select('id')
        .eq('shop_id', ensuredShopId)
        .eq('fiscal_year', fiscalYear)
        .maybeSingle()

      if (existing.error) {
        error = existing.error
      } else if (existing.data) {
        const updateResult = await supabase
          .from('inventory_adjustments')
          .update({ amount: Math.floor(amount) })
          .eq('id', (existing.data as { id: string }).id)
        error = updateResult.error
      } else {
        const insertResult = await supabase.from('inventory_adjustments').insert({
          shop_id: ensuredShopId,
          fiscal_year: fiscalYear,
          amount: Math.floor(amount),
        })
        error = insertResult.error
      }
    }

    setIsSavingInventory(false)

    if (error) {
      if (isMissingTableError(error)) {
        setNotice({
          type: 'error',
          message:
            '在庫調整テーブルが未作成です。Supabaseに expenses / inventory_adjustments を作成してください。',
        })
        return
      }
      setNotice({ type: 'error', message: `在庫調整額の保存に失敗しました: ${error.message}` })
      return
    }

    setNotice({ type: 'success', message: `${inventoryYear}年の在庫合計額を保存しました。` })
  }

  const handleProductSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!shopId) return
    const ensuredShopId = await ensureShopRecord()
    if (!ensuredShopId) return

    const trimmedName = newName.trim()
    const parsedPrice = Number(newPrice)
    const parsedStockQuantity =
      newStockQuantity.trim() === '' ? null : Math.max(0, Math.floor(Number(newStockQuantity)))
    const parsedStockAlert =
      newStockAlertThreshold.trim() === '' ? null : Math.max(0, Math.floor(Number(newStockAlertThreshold)))

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
      shop_id: ensuredShopId,
      name: trimmedName,
      price: Math.floor(parsedPrice),
      tax_rate: 10,
      category: 'その他',
      image_url: imageUrl,
      only_takeout: newOnlyTakeout,
      only_eat_in: newOnlyEatIn,
      stock_quantity: parsedStockQuantity,
      stock_alert_threshold: parsedStockAlert,
    })

    if (isInvalidUuidError(error) && uuidShopId) {
      const retryWithUuid = await supabase.from('menu_items').insert({
        shop_id: ensuredShopId,
        name: trimmedName,
        price: Math.floor(parsedPrice),
        tax_rate: 10,
        category: 'その他',
        image_url: imageUrl,
        only_takeout: newOnlyTakeout,
        only_eat_in: newOnlyEatIn,
        stock_quantity: parsedStockQuantity,
        stock_alert_threshold: parsedStockAlert,
      })
      error = retryWithUuid.error
    }

    if (
      error &&
      (
        isMissingColumnError(error, 'shop_id') ||
        isMissingColumnError(error, 'tax_rate') ||
        isMissingColumnError(error, 'only_takeout') ||
        isMissingColumnError(error, 'only_eat_in') ||
        isMissingColumnError(error, 'stock_quantity') ||
        isMissingColumnError(error, 'stock_alert_threshold')
      )
    ) {
      const legacyPayload = {
        shop_id: ensuredShopId,
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
    setNewStockQuantity('')
    setNewStockAlertThreshold('')
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

  const runAiClassificationForExpenses = useCallback(
    async (targetExpenses: ExpenseRecord[]): Promise<ClassifiedExpense[] | null> => {
      if (targetExpenses.length === 0) {
        setAiClassifiedExpenses([])
        return []
      }

      setIsAiClassifying(true)
      try {
        const response = await fetch('/api/tax/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expenses: targetExpenses.map((expense) => ({
              id: expense.id,
              expense_date: expense.expense_date,
              amount: expense.amount,
              description: expense.description,
              receipt_url: expense.receipt_url,
            })),
          }),
        })

        const data = (await response.json()) as TaxClassifyApiResponse
        if (!response.ok || !data.ok || !Array.isArray(data.classifications)) {
          setNotice({
            type: 'error',
            message: 'AI再判定に失敗しました。ルール判定のみで続行します。',
          })
          return null
        }

        setAiClassifiedExpenses(data.classifications)
        if (data.message) {
          setNotice({ type: 'success', message: data.message })
        }
        return data.classifications
      } catch {
        setNotice({
          type: 'error',
          message: 'AI再判定に失敗しました。ルール判定のみで続行します。',
        })
        return null
      } finally {
        setIsAiClassifying(false)
      }
    },
    []
  )

  const runDemandForecast = async () => {
    setIsForecasting(true)
    try {
      const dailySalesPayload = periodDailySummary.map((row) => ({
        date: row.date,
        grossSales: row.grossSales,
      }))
      const response = await fetch('/api/forecast/demand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dailySales: dailySalesPayload,
          days: 7,
          eventNote: forecastEventNote,
        }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        method?: string
        forecast?: Array<{ date: string; expectedSales: number; factor: number }>
        error?: string
      }
      if (!response.ok || !data.ok || !Array.isArray(data.forecast)) {
        setNotice({ type: 'error', message: data.error ?? '需要予測に失敗しました。' })
        return
      }
      setDemandForecast(data.forecast)
      setNotice({
        type: 'success',
        message: `需要予測を実行しました（${data.method === 'prophet' ? 'Prophet' : 'フォールバック'}）。`,
      })
      void logAuditEvent('demand_forecast', 'forecast', undefined, {
        method: data.method ?? 'unknown',
        days: data.forecast.length,
      })
    } catch (error) {
      setNotice({
        type: 'error',
        message: `需要予測に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setIsForecasting(false)
    }
  }

  const runAutopilotWorkflow = useCallback(async () => {
    const range = getPreviousFiscalYearRange()
    setStartDate(range.start)
    setEndDate(range.end)
    setInventoryYear(range.end.slice(0, 4))
    setIsAutopilotRunning(true)
    setNotice(null)

    try {
      const loaded = await fetchPeriodSales(range)
      const inventoryValue = (await fetchInventoryAdjustment(range.end.slice(0, 4))) ?? 0
      const initial = classifyExpenses(loaded?.expenses ?? [])
      const shouldEscalate = initial.some((item) => item.rank === 'REVIEW')
      const ai = shouldEscalate ? await runAiClassificationForExpenses(loaded?.expenses ?? []) : null
      const finalClassifications = ai ?? initial
      const summary = summarizeClassifiedExpenses(finalClassifications, 0.1)
      const localReadiness = buildFilingReadiness({
        startDate: range.start,
        endDate: range.end,
        salesCount: loaded?.sales.length ?? 0,
        salesGross: (loaded?.sales ?? []).reduce((sum, sale) => sum + sale.total_amount, 0),
        expenseCount: (loaded?.expenses ?? []).length,
        expenseTotal: (loaded?.expenses ?? []).reduce((sum, expense) => sum + expense.amount, 0),
        inventoryAmount: inventoryValue,
        classificationSummary: summary,
        classifiedExpenses: finalClassifications,
      })
      const blockerMessage = localReadiness.items
        .filter((item) => item.status === 'BLOCKER')
        .map((item) => `${item.title}: ${item.reason}`)
        .join(' / ')
      setNotice({
        type: localReadiness.exportBlocked ? 'error' : 'success',
        message: localReadiness.exportBlocked
          ? `自動ワークフロー完了（${range.start}〜${range.end}）。${blockerMessage}`
          : `自動ワークフローを実行しました（対象期間: ${range.start}〜${range.end}）。申告準備度 ${localReadiness.score}%`,
      })
      return { summary, readiness: localReadiness }
    } finally {
      setIsAutopilotRunning(false)
    }
  }, [fetchInventoryAdjustment, fetchPeriodSales, runAiClassificationForExpenses])

  const exportSalesCsv = () => {
    const csv = buildSalesCsv()
    downloadTextFile(
      `sales-ledger-${startDate}-to-${endDate}.csv`,
      csv,
      'text/csv;charset=utf-8;'
    )
  }

  const buildSalesCsv = () => {
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

    return ['\uFEFF' + header.join(','), ...rows.map((row) => row.join(','))].join('\n')
  }

  const exportExpensesCsv = () => {
    const csv = buildExpensesCsv()
    downloadTextFile(
      `expense-ledger-${startDate}-to-${endDate}.csv`,
      csv,
      'text/csv;charset=utf-8;'
    )
  }

  const buildExpensesCsv = () => {
    const header = ['日付', '金額', '内容', 'レシートURL', '判定', '信頼度', '勘定科目候補', '理由', '登録日時']
    const rows = expenses.map((expense) => {
      const classification = expenseClassificationMap.get(expense.id)
      return [
        escapeCsv(expense.expense_date),
        String(expense.amount),
        escapeCsv(expense.description),
        escapeCsv(expense.receipt_url ?? ''),
        escapeCsv(classification?.rank ?? 'REVIEW'),
        String(classification?.confidence ?? 0),
        escapeCsv(classification?.accountItem ?? '雑費'),
        escapeCsv(classification?.reason ?? '判定未実行'),
        escapeCsv(formatDateTime(expense.created_at)),
      ]
    })

    return ['\uFEFF' + header.join(','), ...rows.map((row) => row.join(','))].join('\n')
  }

  const exportProfitSummaryCsv = () => {
    const csv = buildProfitSummaryCsv()
    downloadTextFile(
      `profit-summary-${startDate}-to-${endDate}.csv`,
      csv,
      'text/csv;charset=utf-8;'
    )
  }

  const buildProfitSummaryCsv = () => {
    const header = ['開始日', '終了日', '売上（税込）', '経費合計', '在庫調整', '利益', '計算式']
    const row = [
      escapeCsv(startDate),
      escapeCsv(endDate),
      String(periodSummary.grossSales),
      String(periodExpenseTotal),
      String(inventoryAdjustmentAmount),
      String(periodProfit),
      escapeCsv('売上 - 経費 - 在庫調整'),
    ]
    return ['\uFEFF' + header.join(','), row.join(',')].join('\n')
  }

  const downloadTaxPackZip = async () => {
    const zip = new JSZip()
    const safeShopName = String(shopName ?? 'shop').replaceAll(/[\\/:*?"<>|]/g, '_')
    const readinessChecklist = filingReadiness.items
      .map(
        (item, index) =>
          `${index + 1}. [${filingItemStatusLabel(item.status)}] ${item.title}\n   理由: ${item.reason}\n   対応: ${item.action}`
      )
      .join('\n')

    zip.file(`sales-ledger-${startDate}-to-${endDate}.csv`, buildSalesCsv())
    zip.file(`expense-ledger-${startDate}-to-${endDate}.csv`, buildExpensesCsv())
    zip.file(`profit-summary-${startDate}-to-${endDate}.csv`, buildProfitSummaryCsv())
    zip.file(
      `filing-readiness-${startDate}-to-${endDate}.json`,
      JSON.stringify(filingReadiness, null, 2)
    )
    zip.file(
      `tax-accountant-handoff-${startDate}-to-${endDate}.md`,
      [
        `# 税理士引き継ぎメモ (${startDate}〜${endDate})`,
        '',
        `- 店舗: ${shopName ?? '未設定'} (${activeShopId ?? 'unknown'})`,
        `- 申告準備度: ${filingReadiness.score}% / ${filingReadinessStatusLabel(filingReadiness.status)}`,
        '',
        '## チェックリスト',
        readinessChecklist,
      ].join('\n')
    )
    zip.file(
      `summary-${startDate}-to-${endDate}.json`,
      JSON.stringify(
        {
          shop: { id: activeShopId, name: shopName ?? null },
          period: { startDate, endDate },
          totals: {
            sales_gross: periodSummary.grossSales,
            sales_net: periodSummary.netSales,
            sales_tax: periodSummary.taxTotal,
            expenses_total: periodExpenseTotal,
            inventory_adjustment: inventoryAdjustmentAmount,
            profit: periodProfit,
          },
          classification: expenseClassificationSummary,
          filing_readiness: filingReadiness,
          generated_at: new Date().toISOString(),
        },
        null,
        2
      )
    )
    zip.file(
      'README.txt',
      [
        '申告パック（自動生成）',
        '',
        '含まれるもの:',
        '- sales-ledger: 売上の帳簿（CSV）',
        '- expense-ledger: 経費の帳簿 + 自動判定（CSV）',
        '- profit-summary: 期間の損益サマリー（CSV）',
        '- filing-readiness: 申告準備度チェック（JSON）',
        '- tax-accountant-handoff: 税理士向け確認メモ（Markdown）',
        '- summary: 集計値と出力メタ情報（JSON）',
        '',
        '注意:',
        '- 自動判定は補助です。必要に応じて証憑（レシート/請求書/カード明細）と照合してください。',
        '- 人件費（給与）などは、経費として記帳されている前提で集計されます。',
      ].join('\n')
    )

    const blob = await zip.generateAsync({ type: 'blob' })
    downloadBlobFile(`tax-pack-${safeShopName}-${startDate}-to-${endDate}.zip`, blob)
  }

  const exportMonthlyCsvPack = (options?: { force?: boolean }) => {
    if (isExportBlocked && !options?.force) {
      setNotice({
        type: 'error',
        message: `出力を停止しました。${exportBlockerMessage}`,
      })
      return
    }
    exportSalesCsv()
    exportExpensesCsv()
    exportProfitSummaryCsv()
    setNotice({ type: 'success', message: '月次提出用CSVを3点出力しました。' })
  }

  const exportTaxPackManually = async () => {
    if (isExportBlocked) {
      setNotice({
        type: 'error',
        message: `出力前に対応が必要です。${exportBlockerMessage}`,
      })
      return
    }
    await downloadTaxPackZip()
    void logAuditEvent('tax_pack_export_manual', 'tax_pack', `${startDate}_${endDate}`, {
      readinessStatus: filingReadiness.status,
      readinessScore: filingReadiness.score,
    })
    setNotice({ type: 'success', message: '税理士共有パック（zip）を出力しました。' })
  }

  const runAutopilotAndExport = async () => {
    const workflowResult = await runAutopilotWorkflow()
    if (!workflowResult || workflowResult.readiness.exportBlocked) return
    await downloadTaxPackZip()
    void logAuditEvent('tax_pack_export_autopilot', 'tax_pack', `${startDate}_${endDate}`, {
      readinessStatus: workflowResult.readiness.status,
      readinessScore: workflowResult.readiness.score,
    })
    setNotice({ type: 'success', message: '税理士共有パック（zip）を出力しました。' })
  }

  useEffect(() => {
    if (mode !== 'tax' || hasAutoInitializedTaxMode) return
    setHasAutoInitializedTaxMode(true)
    void runAutopilotWorkflow()
  }, [hasAutoInitializedTaxMode, mode, runAutopilotWorkflow])

  const exportFreeeExpenseJson = async () => {
    if (isExportBlocked) {
      setNotice({
        type: 'error',
        message: `出力前に対応が必要です。${exportBlockerMessage}`,
      })
      return
    }

    // 書き出し直前に取り直す（売上が0件の月でも経費だけはあるケースが多い）
    const result = await queryPeriodExpenses()
    if (result.ok) {
      setExpenses(result.expenses)
    }

    if (!result.ok && result.kind === 'missing_table') {
      setNotice({
        type: 'error',
        message: '経費帳テーブルが未作成です（Supabaseに expenses を作成してください）。',
      })
      return
    }

    if (!result.ok && result.kind === 'error') {
      setNotice({ type: 'error', message: `経費取得に失敗しました: ${result.message}` })
      return
    }

    const sourceExpenses = result.ok ? result.expenses : expenses
    const sourceClassifications = classifyExpenses(sourceExpenses)
    const exportableExpenses = sourceExpenses.filter((expense) => {
      const c = sourceClassifications.find((item) => item.expenseId === expense.id)
      return c?.rank === 'OK'
    })

    if (exportableExpenses.length === 0) {
      setNotice({
        type: 'error',
        message:
          '期間内に自動判定OKの経費がありません。要確認キューを先に解消してください。',
      })
      return
    }

    const payload = exportableExpenses.map((expense) => ({
      issue_date: expense.expense_date,
      amount: expense.amount,
      description: expense.description,
      receipt_url: expense.receipt_url,
      deal_type: 'expense',
    }))

    const content = JSON.stringify(
      {
        period_start: startDate,
        period_end: endDate,
        shop_id: activeShopId,
        auto_classified: true,
        excluded_count: sourceExpenses.length - exportableExpenses.length,
        record_count: payload.length,
        expenses: payload,
      },
      null,
      2
    )

    downloadTextFile(
      `freee-expense-draft-${startDate}-to-${endDate}.json`,
      content,
      'application/json;charset=utf-8;'
    )
    setNotice({ type: 'success', message: '経費JSONを出力しました。' })
  }

  const syncExpensesToFreeeAutomatically = async () => {
    if (isExportBlocked) {
      setNotice({ type: 'error', message: `出力前に対応が必要です。${exportBlockerMessage}` })
      return
    }

    const result = await queryPeriodExpenses()
    if (!result.ok) {
      setNotice({ type: 'error', message: '経費取得に失敗しました。期間と導入設定を確認してください。' })
      return
    }

    const sourceExpenses = result.expenses
    const sourceClassifications = classifyExpenses(sourceExpenses)
    const exportableExpenses = sourceExpenses.filter((expense) => {
      const c = sourceClassifications.find((item) => item.expenseId === expense.id)
      return c?.rank === 'OK'
    })

    if (exportableExpenses.length === 0) {
      setNotice({ type: 'error', message: 'freeeに送信できるOK経費がありません。' })
      return
    }

    setIsSendingFreeeDeals(true)
    try {
      const response = await fetch('/api/freee/auto-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenses: exportableExpenses, limit: 100 }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        success?: number
        failed?: number
        error?: string
        accountItem?: string
        taxCode?: number
      }
      if (!response.ok || !data.ok) {
        setNotice({ type: 'error', message: data.error ?? 'freee自動連携に失敗しました。' })
        return
      }
      setFreeeLastSendSummary({
        success: data.success ?? 0,
        failed: data.failed ?? 0,
        total: (data.success ?? 0) + (data.failed ?? 0),
        lastRunAt: new Date().toISOString(),
      })
      setNotice({
        type: data.failed ? 'error' : 'success',
        message: `freee自動連携: 成功 ${data.success ?? 0} 件 / 失敗 ${data.failed ?? 0} 件（勘定科目 ${data.accountItem ?? '-'} / 税区分 ${data.taxCode ?? '-'}）`,
      })
      void logAuditEvent('freee_auto_expenses_sync', 'expenses', undefined, {
        success: data.success ?? 0,
        failed: data.failed ?? 0,
      })
    } catch (error) {
      setNotice({
        type: 'error',
        message: `freee自動連携に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setIsSendingFreeeDeals(false)
    }
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

      <div className="mx-auto w-full max-w-7xl p-4">
        <div className="sticky top-0 z-20 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl text-slate-900">
                  <span className="text-[1.05em] font-extrabold">{shopName || '店舗ダッシュボード'}</span>
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
              <div className="mb-4 grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => setTaxMode('takeout')}
                  className={`rounded-xl px-4 py-3 text-base font-bold transition ${
                    taxMode === 'takeout'
                      ? 'bg-orange-500 text-white shadow'
                      : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                  }`}
                >
                  テイクアウト 8%
                </button>
                <button
                  onClick={() => setTaxMode('dine-in')}
                  className={`rounded-xl px-4 py-3 text-base font-bold transition ${
                    taxMode === 'dine-in'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  店内飲食 10%
                </button>
              </div>
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
                          {item.stock_quantity != null ? (
                            <p
                              className={`text-xs ${
                                item.stock_alert_threshold != null && item.stock_quantity <= item.stock_alert_threshold
                                  ? 'font-semibold text-red-600'
                                  : 'text-slate-500'
                              }`}
                            >
                              在庫: {item.stock_quantity}
                            </p>
                          ) : null}
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

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-semibold">初期在庫（任意）</label>
                    <input
                      type="number"
                      min={0}
                      value={newStockQuantity}
                      onChange={(event) => setNewStockQuantity(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-3"
                      placeholder="例: 120"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold">在庫アラート閾値（任意）</label>
                    <input
                      type="number"
                      min={0}
                      value={newStockAlertThreshold}
                      onChange={(event) => setNewStockAlertThreshold(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-3"
                      placeholder="例: 20"
                    />
                  </div>
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
                          {item.stock_quantity != null ? (
                            <p
                              className={`text-xs ${
                                item.stock_alert_threshold != null && item.stock_quantity <= item.stock_alert_threshold
                                  ? 'font-semibold text-red-600'
                                  : 'text-slate-500'
                              }`}
                            >
                              在庫 {item.stock_quantity}
                              {item.stock_alert_threshold != null ? ` / 閾値 ${item.stock_alert_threshold}` : ''}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400">在庫未設定</p>
                          )}
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
                        {item.stock_quantity != null && (
                          <div className="ml-auto flex items-center gap-2">
                            <button
                              onClick={() => void adjustSingleItemStock(item.id, -1)}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                            >
                              在庫-1
                            </button>
                            <button
                              onClick={() => void adjustSingleItemStock(item.id, 1)}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                            >
                              在庫+1
                            </button>
                          </div>
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
            <h2 className="text-2xl font-bold text-slate-900">税務レポート（税理士共有用）</h2>
            <p className="mt-1 text-base text-slate-600">
              税理士の最終チェック前までを自動化します。普段は共有パックの保存だけで進めてください。
            </p>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">申告コックピット（入力ゼロ）</h3>
                  <p className="text-base text-slate-700">
                    分からなければワンタップ。必要なときだけ下の詳細を確認できます。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={runAutopilotAndExport}
                    disabled={isAutopilotRunning || isPeriodLoading || isAiClassifying}
                    className="rounded-lg bg-slate-900 px-6 py-3 text-base font-black text-white disabled:bg-slate-400"
                  >
                    {isAutopilotRunning || isAiClassifying ? '自動処理中...' : '税理士共有パックを作成して保存'}
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {workflowSteps.map((step) => (
                  <div key={step.id} className={`rounded-md border px-3 py-2 text-sm font-semibold ${workflowStepClass(step.status)}`}>
                    {step.label}
                  </div>
                ))}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-5">
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs text-slate-500">自動確定（OK）</p>
                  <p className="text-xl font-black text-emerald-700">{expenseClassificationSummary.okCount}</p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs text-slate-500">要確認</p>
                  <p className="text-xl font-black text-amber-700">{expenseClassificationSummary.reviewCount}</p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs text-slate-500">NG</p>
                  <p className="text-xl font-black text-red-700">{expenseClassificationSummary.ngCount}</p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs text-slate-500">申告準備度</p>
                  <p className={`text-xl font-black ${filingReadinessStatusClass(filingReadiness.status)}`}>
                    {filingReadiness.score}%
                  </p>
                  <p className="text-xs text-slate-500">{filingReadinessStatusLabel(filingReadiness.status)}</p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs text-slate-500">出力判定</p>
                  <p className={`text-xl font-black ${isExportBlocked ? 'text-red-700' : 'text-emerald-700'}`}>
                    {isExportBlocked ? '保留' : '出力可能'}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                要確認の許容上限は {expenseClassificationSummary.maxReviewAllowed} 件です（全件の10%まで）。
              </p>
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900">税理士に渡す前の不足項目</p>
                {filingReadiness.items.filter((item) => item.status !== 'READY').length === 0 ? (
                  <p className="mt-2 text-sm text-emerald-700">不足項目はありません。このまま提出パックを作成できます。</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {filingReadiness.items
                      .filter((item) => item.status !== 'READY')
                      .map((item) => (
                        <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${filingItemStatusClass(item.status)}`}>
                              {filingItemStatusLabel(item.status)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <details
              className="mt-4 rounded-xl border border-slate-200 bg-white p-4"
              open={showTaxDeepDive}
              onToggle={(event) => {
                const nextOpen = (event.currentTarget as HTMLDetailsElement).open
                setShowTaxDeepDive(nextOpen)
              }}
            >
              <summary className="cursor-pointer select-none text-base font-black text-slate-900">詳細を見る</summary>
              <p className="mt-2 text-sm text-slate-600">
                期間・内訳・根拠を見ながら自分で納得して進めたい人向けです。分からなければ閉じてワンタップだけでOKです。
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
                    onClick={() => void fetchPeriodSales()}
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

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-lg font-bold text-slate-900">税理士引き継ぎチェック（詳細）</h3>
                <p className="mt-1 text-sm text-slate-600">
                  ここで「要対応」をゼロに近づけるほど、税理士の最終確認だけで提出しやすくなります。
                </p>
                <div className="mt-3 space-y-2">
                  {filingReadiness.items.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${filingItemStatusClass(item.status)}`}>
                          {filingItemStatusLabel(item.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">理由: {item.reason}</p>
                      <p className="mt-1 text-xs text-slate-500">対応: {item.action}</p>
                    </div>
                  ))}
                </div>
              </div>

	            <div className="mt-4 rounded-xl border border-slate-200 bg-amber-50/40 p-4">
	              <div className="flex flex-wrap items-center justify-between gap-2">
	                <h3 className="text-lg font-bold text-slate-900">導入チェック</h3>
                <div className="flex gap-2">
                  <button
                    onClick={runSetupChecks}
                    disabled={isSetupChecking}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-semibold disabled:bg-slate-100"
                  >
                    {isSetupChecking ? '確認中...' : '再チェック'}
                  </button>
                  {setupIssues.length > 0 && (
                    <button
                      onClick={() => setIsLedgerTemporarilyDisabled(true)}
                      className="rounded-md border border-red-200 bg-white px-3 py-1 text-sm font-semibold text-red-700"
                    >
                      経費/在庫を一時オフ
                    </button>
                  )}
                </div>
              </div>

              {setupIssues.length === 0 ? (
                <p className="mt-2 text-sm text-emerald-700">
                  導入チェックは正常です。必要なテーブル・バケット・環境キーを確認しました。
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {setupIssues.map((issue) => (
                    <div key={issue.id} className="rounded-lg border border-amber-200 bg-white p-3">
                      <p className="font-semibold text-slate-900">{issue.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{issue.detail}</p>
                      <p className="mt-2 text-xs font-semibold text-slate-700">{issue.actionLabel}</p>
                      <pre className="mt-1 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
{issue.actionBody}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isLedgerFeatureEnabled ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <section className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-bold text-slate-900">超シンプル経費帳</h3>
                  <button
                    onClick={fetchPeriodExpenses}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm"
                  >
                    経費を再取得
                  </button>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  日付・金額・内容・レシート写真だけ記録します（期間内データを表示）。
                </p>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-bold text-slate-900">初回データ取込（既存データ）</h4>
                  <p className="mt-1 text-xs text-slate-600">
                    既存の売上・経費CSVをここで一括投入できます。初回導入時に使ってください。
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">売上CSV</label>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => setSalesCsvFile(event.target.files?.[0] ?? null)}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                      />
                      <button
                        type="button"
                        onClick={importSalesCsv}
                        disabled={isImportingSalesCsv || !salesCsvFile}
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {isImportingSalesCsv ? '取込中...' : '売上CSVを取込'}
                      </button>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">経費CSV</label>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => setExpensesCsvFile(event.target.files?.[0] ?? null)}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                      />
                      <button
                        type="button"
                        onClick={importExpensesCsv}
                        disabled={isImportingExpensesCsv || !expensesCsvFile}
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {isImportingExpensesCsv ? '取込中...' : '経費CSVを取込'}
                      </button>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleExpenseSubmit} className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-semibold">日付</label>
                    <input
                      type="date"
                      value={expenseDate}
                      onChange={(event) => setExpenseDate(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold">金額</label>
                    <input
                      type="number"
                      min={1}
                      value={expenseAmount}
                      onChange={(event) => setExpenseAmount(event.target.value)}
                      placeholder="例: 1200"
                      className="w-full rounded-lg border border-slate-300 p-2"
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-semibold">内容</label>
                    <input
                      type="text"
                      value={expenseDescription}
                      onChange={(event) => setExpenseDescription(event.target.value)}
                      placeholder="例: 包装資材"
                      className="w-full rounded-lg border border-slate-300 p-2"
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-semibold">レシート写真（任意）</label>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleExpenseReceiptChange}
                      className="w-full rounded-lg border border-slate-300 bg-white p-2"
                    />
                    {expenseReceiptPreview && (
                      <div className="mt-2 flex items-center gap-3">
                        <img
                          src={expenseReceiptPreview}
                          alt="レシートプレビュー"
                          className="h-24 w-24 rounded-lg border border-slate-300 object-cover"
                        />
                        <button
                          type="button"
                          onClick={applyExpenseFromReceiptImage}
                          disabled={isReceiptOcrRunning}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {isReceiptOcrRunning ? '抽出中...' : '画像から内容を自動入力'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <button
                      type="submit"
                      disabled={isSavingExpense}
                      className="w-full rounded-lg bg-blue-600 px-4 py-3 font-bold text-white disabled:bg-slate-400"
                    >
                      {isSavingExpense ? '保存中...' : '経費を保存'}
                    </button>
                  </div>
                </form>

                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span>期間経費合計</span>
                    <span className="font-bold">{formatYen(periodExpenseTotal)}</span>
                  </div>
                </div>

                <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-100">
                      <tr>
                        <th className="p-2 text-left">日付</th>
                        <th className="p-2 text-left">内容</th>
                        <th className="p-2 text-right">金額</th>
                        <th className="p-2 text-left">自動判定</th>
                        <th className="p-2 text-center">レシート</th>
                        <th className="p-2 text-center">削除</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isExpenseLoading ? (
                        <tr>
                          <td colSpan={6} className="p-3 text-center text-slate-500">
                            経費を読み込み中...
                          </td>
                        </tr>
                      ) : expenses.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-3 text-center text-slate-500">
                            この期間の経費はまだありません。
                          </td>
                        </tr>
                      ) : (
                        expenses.map((expense) => {
                          const classification = expenseClassificationMap.get(expense.id)
                          const rank = classification?.rank ?? 'REVIEW'
                          return (
                            <tr key={expense.id} className="border-b border-slate-100">
                            <td className="p-2">{formatDate(`${expense.expense_date}T00:00:00`)}</td>
                            <td className="p-2">{expense.description}</td>
                            <td className="p-2 text-right font-semibold">{formatYen(expense.amount)}</td>
                            <td className="p-2 text-xs">
                              <span
                                className={`rounded-full px-2 py-1 font-semibold ${
                                  rank === 'OK'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : rank === 'NG'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-amber-100 text-amber-700'
                                }`}
                              >
                                {rank === 'OK' ? 'OK' : rank === 'NG' ? 'NG' : '要確認'}
                              </span>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {classification?.accountItem ?? '雑費'} / 信頼度 {classification?.confidence ?? 0}%
                              </p>
                              <p className="text-[11px] text-slate-500">{classification?.reason ?? '判定未実行'}</p>
                              {classification?.provider ? (
                                <p className="text-[11px] text-slate-400">
                                  {classification.provider} ({classification.model ?? '-'})
                                </p>
                              ) : null}
                            </td>
                            <td className="p-2 text-center">
                              {expense.receipt_url ? (
                                <button
                                  type="button"
                                  onClick={() => void openExpenseReceipt(expense.id, expense.receipt_url ?? '')}
                                  disabled={openingReceiptExpenseId === expense.id}
                                  className="text-blue-600 underline disabled:text-slate-400"
                                >
                                  {openingReceiptExpenseId === expense.id ? '生成中...' : '表示'}
                                </button>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="p-2 text-center">
                              <button
                                onClick={() => deleteExpense(expense.id)}
                                className="rounded border border-red-200 px-2 py-1 text-xs text-red-600"
                              >
                                削除
                              </button>
                            </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-xl border border-slate-200 p-4">
                  <h3 className="text-lg font-bold text-slate-900">在庫調整（年1回）</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    年末在庫の合計額を1つだけ入力し、利益計算に反映します。
                  </p>

                  <div className="mt-3 grid gap-3">
                    <div>
                      <label className="mb-1 block text-sm font-semibold">対象年</label>
                      <input
                        type="number"
                        min={2000}
                        max={9999}
                        value={inventoryYear}
                        onChange={(event) => setInventoryYear(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 p-2"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-semibold">在庫の合計額</label>
                      <input
                        type="number"
                        min={0}
                        value={inventoryAmount}
                        onChange={(event) => setInventoryAmount(event.target.value)}
                        placeholder="例: 300000"
                        className="w-full rounded-lg border border-slate-300 p-2"
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        onClick={handleSaveInventoryAdjustment}
                        disabled={isSavingInventory}
                        className="rounded-lg bg-slate-900 px-4 py-2 font-bold text-white disabled:bg-slate-400"
                      >
                        {isSavingInventory ? '保存中...' : '在庫額を保存'}
                      </button>
                      <button
                        onClick={() => void fetchInventoryAdjustment()}
                        className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
                      >
                        読み直し
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-lg font-bold text-slate-900">利益ダッシュボード</h3>
                  <p className="mt-1 text-sm text-slate-500">売上 - 経費 - 在庫調整 = 利益</p>

                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between rounded-md bg-white px-3 py-2">
                      <span>売上（税込）</span>
                      <span className="font-bold">{formatYen(periodSummary.grossSales)}</span>
                    </div>
                    <div className="flex justify-between rounded-md bg-white px-3 py-2">
                      <span>経費合計</span>
                      <span className="font-bold">-{formatYen(periodExpenseTotal)}</span>
                    </div>
                    <div className="flex justify-between rounded-md bg-white px-3 py-2">
                      <span>在庫調整（{inventoryYear}年）</span>
                      <span className="font-bold">-{formatYen(inventoryAdjustmentAmount)}</span>
                    </div>
                    <div className="flex justify-between rounded-md border border-slate-300 bg-white px-3 py-3 text-base">
                      <span className="font-bold">利益</span>
                      <span className={`font-black ${periodProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {periodProfit < 0 ? '-' : ''}
                        {formatYen(Math.abs(periodProfit))}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-lg font-bold text-slate-900">店主向けモード（かんたん実行）</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    基本は上の「税理士共有パックを作成して保存」だけで運用できます。
                    freee連携や予測は必要なときだけ下の詳細カードで実行してください。
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-bold text-slate-900">シフト管理（カレンダー）</h3>
                    <button
                      onClick={() => void fetchShifts()}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm"
                    >
                      読み直し
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">日付・勤務時間を入れると人件費を自動集計します。</p>
                  <form onSubmit={handleSaveShift} className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input
                      type="date"
                      value={shiftDate}
                      onChange={(event) => setShiftDate(event.target.value)}
                      className="rounded-lg border border-slate-300 p-2 text-sm"
                      required
                    />
                    <input
                      type="text"
                      value={shiftStaffName}
                      onChange={(event) => setShiftStaffName(event.target.value)}
                      placeholder="スタッフ名"
                      className="rounded-lg border border-slate-300 p-2 text-sm"
                      required
                    />
                    <input
                      type="time"
                      value={shiftStartTime}
                      onChange={(event) => setShiftStartTime(event.target.value)}
                      className="rounded-lg border border-slate-300 p-2 text-sm"
                      required
                    />
                    <input
                      type="time"
                      value={shiftEndTime}
                      onChange={(event) => setShiftEndTime(event.target.value)}
                      className="rounded-lg border border-slate-300 p-2 text-sm"
                      required
                    />
                    <input
                      type="number"
                      min={0}
                      value={shiftHourlyWage}
                      onChange={(event) => setShiftHourlyWage(event.target.value)}
                      placeholder="時給"
                      className="rounded-lg border border-slate-300 p-2 text-sm"
                    />
                    <input
                      type="number"
                      min={0}
                      value={shiftBreakMinutes}
                      onChange={(event) => setShiftBreakMinutes(event.target.value)}
                      placeholder="休憩(分)"
                      className="rounded-lg border border-slate-300 p-2 text-sm"
                    />
                    <div className="sm:col-span-2 grid grid-cols-2 gap-2">
                      <button
                        type="submit"
                        disabled={isSavingShift}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-400"
                      >
                        {isSavingShift ? '保存中...' : 'シフト保存'}
                      </button>
                      <button
                        type="button"
                        onClick={syncShiftsToFreeeHr}
                        disabled={isSyncingFreeeHr || shifts.length === 0}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100"
                      >
                        {isSyncingFreeeHr ? '同期中...' : 'freee人事へ同期'}
                      </button>
                    </div>
                  </form>
                  <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
                    推定人件費（期間）: <span className="font-bold">{formatYen(shiftLaborTotal)}</span>
                  </div>
                  <div className="mt-2 max-h-32 overflow-y-auto rounded-md border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          <th className="p-2 text-left">日付</th>
                          <th className="p-2 text-left">氏名</th>
                          <th className="p-2 text-right">人件費</th>
                        </tr>
                      </thead>
                      <tbody>
                        {isShiftLoading ? (
                          <tr>
                            <td className="p-2 text-slate-500" colSpan={3}>
                              読み込み中...
                            </td>
                          </tr>
                        ) : shifts.length === 0 ? (
                          <tr>
                            <td className="p-2 text-slate-500" colSpan={3}>
                              この期間のシフトはありません。
                            </td>
                          </tr>
                        ) : (
                          shifts.slice(0, 12).map((shift) => {
                            const labor = Math.floor(
                              toShiftHours(shift.start_time, shift.end_time, shift.break_minutes) * shift.hourly_wage
                            )
                            return (
                              <tr key={shift.id} className="border-t border-slate-100">
                                <td className="p-2">{shift.shift_date}</td>
                                <td className="p-2">{shift.staff_name}</td>
                                <td className="p-2 text-right">{formatYen(labor)}</td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <h3 className="text-lg font-bold text-slate-900">需要予測（7日）</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    過去売上から予測し、イベント情報（例: 浜松コンサート）で補正します。
                  </p>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={forecastEventNote}
                      onChange={(event) => setForecastEventNote(event.target.value)}
                      placeholder="イベント情報（任意）"
                      className="flex-1 rounded-lg border border-slate-300 p-2 text-sm"
                    />
                    <button
                      onClick={runDemandForecast}
                      disabled={isForecasting}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-400"
                    >
                      {isForecasting ? '予測中...' : '予測する'}
                    </button>
                  </div>
                  {demandForecast && demandForecast.length > 0 ? (
                    <div className="mt-3 max-h-36 overflow-y-auto rounded-md border border-slate-200">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-50">
                          <tr>
                            <th className="p-2 text-left">日付</th>
                            <th className="p-2 text-right">予測売上</th>
                          </tr>
                        </thead>
                        <tbody>
                          {demandForecast.map((point) => (
                            <tr key={point.date} className="border-t border-slate-100">
                              <td className="p-2">{point.date}</td>
                              <td className="p-2 text-right">{formatYen(point.expectedSales)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <h3 className="text-lg font-bold text-slate-900">freee自動反映（経費）</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    CSV/JSONダウンロードを省略し、OK判定の経費をfreeeへ直接ポストします。
                  </p>
                  <button
                    onClick={syncExpensesToFreeeAutomatically}
                    disabled={isSendingFreeeDeals}
                    className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400"
                  >
                    {isSendingFreeeDeals ? '送信中...' : 'freeeへ自動反映'}
                  </button>
                  {freeeLastSendSummary ? (
                    <p className="mt-2 text-xs text-slate-500">
                      前回: 成功 {freeeLastSendSummary.success} / 失敗 {freeeLastSendSummary.failed} / 合計{' '}
                      {freeeLastSendSummary.total}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-base font-bold text-slate-900">プライバシーポリシー（運用）</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    RLSで店舗分離、レシートは非公開Storage+署名URL、監査ログでアクセス記録。個人情報はLLM送信前にマスクします。
                    詳細は docs/security を参照してください。
                  </p>
                </div>
              </section>
            </div>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p>経費/在庫機能は一時オフです。設定修正後に再表示できます。</p>
                <button
                  onClick={() => setIsLedgerTemporarilyDisabled(false)}
                  className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-semibold"
                >
                  再表示
                </button>
              </div>
            )}

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
                    <h3 className="mb-3 text-lg font-bold text-slate-900">エクスポート（提出用）</h3>
                    <button
                      onClick={exportTaxPackManually}
                      disabled={isExportBlocked}
                      className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-base font-semibold text-white disabled:bg-slate-400"
                    >
                      税理士共有パックZIPを保存
                    </button>
                    <p className="mt-2 text-xs text-slate-500">
                      通常はこの1つだけ使えば十分です。個別ファイルは必要なときだけ下で展開します。
                    </p>
                    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-700">
                        詳細出力（個別CSV/PDF）
                      </summary>
                      <div className="mt-3 space-y-2">
                        <button
                          onClick={exportMonthlyCsvPack}
                          disabled={isExportBlocked}
                          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold"
                        >
                          月次CSV 3点をまとめて保存
                        </button>
                        <button
                          onClick={exportSalesCsv}
                          disabled={isExportBlocked}
                          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold"
                        >
                          売上CSV
                        </button>
                        <button
                          onClick={exportExpensesCsv}
                          disabled={isExportBlocked}
                          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold"
                        >
                          経費CSV
                        </button>
                        <button
                          onClick={exportProfitSummaryCsv}
                          disabled={isExportBlocked}
                          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold"
                        >
                          利益サマリーCSV
                        </button>
                        <button
                          onClick={exportPeriodPdf}
                          disabled={isExportBlocked}
                          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold"
                        >
                          PDFで保存
                        </button>
                      </div>
                    </details>
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
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
