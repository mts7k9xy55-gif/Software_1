'use client'

import { useEffect, useMemo, useState } from 'react'
import { useClerk, useUser } from '@clerk/nextjs'
import { CheckCircle2, ScanLine, ShieldCheck } from 'lucide-react'

import type {
  AccountingProvider,
  CanonicalTransaction,
  ClassificationDecision,
  OperationMode,
  PostingCommand,
  PostingResult,
  ReviewQueueItem,
  TenantContext,
} from '@/lib/core/types'
import type { RegionDefinition } from '@/lib/core/regions'
import { useI18n } from '@/lib/I18nContext'
import { formatMoney as formatMoneyI18n } from '@/lib/i18n'

type TabKey = 'transactions' | 'queue'

type Notice = {
  type: 'success' | 'error'
  message: string
  code?: string
  nextAction?: string
  contact?: string
}

type LocalRecord = {
  transaction: CanonicalTransaction
  decision: ClassificationDecision
  posted?: PostingResult
}

type CsvImportRow = {
  date: string
  amount: number
  description: string
  counterparty?: string
  direction: 'income' | 'expense'
}

type ProviderStatus = {
  provider: AccountingProvider
  label: string
  configured: boolean
  connected: boolean
  mode: 'shared_token' | 'oauth_per_user'
  account_context: string | null
  next_action: string
  contact: string
  support_name: string
  docs_url: string
}

type ConnectorStatus = {
  provider: AccountingProvider
  provider_status?: ProviderStatus
  providers: ProviderStatus[]
  ocr: {
    enabled: boolean
    provider: string
  }
  llm: {
    externalEnabled: boolean
    model: string
  }
  packs: Array<{ key: string; title: string }>
  tenant: TenantContext
  support_boundary: {
    owner_scope: string
    provider_scope: string
  }
  region?: {
    code: string
    name: string
    countryCode: string
    uxLabel: string
    platforms: Array<{ key: string; name: string; category: string; status: string }>
  }
}

type FilingOrchestratorAppProps = {
  region: RegionDefinition
  onSwitchRegion: () => void
}

const MODE_STORAGE_KEY = 'taxman:operation_mode'


async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('failed to read file'))
    }
    reader.onerror = () => reject(new Error('failed to read file'))
    reader.readAsDataURL(file)
  })
}

function normalizeMode(input: string): OperationMode {
  return input === 'direct' ? 'direct' : 'tax_pro'
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current.trim())
  return cells
}

function normalizeCsvHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function normalizeCsvDate(value: string): string {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10)
  return parsed.toISOString().slice(0, 10)
}

function parseCurrencyNumber(raw: string): number {
  const normalized = String(raw ?? '')
    .replace(/[^\d.-]/g, '')
    .trim()
  const value = Number(normalized)
  if (!Number.isFinite(value)) return 0
  return Math.floor(Math.abs(value))
}

function pickHeaderIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const index = headers.findIndex((header) => header === candidate)
    if (index >= 0) return index
  }
  return -1
}

function parseLedgerCsv(text: string): { rows: CsvImportRow[]; skipped: number } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) return { rows: [], skipped: 0 }

  const headers = parseCsvLine(lines[0]).map(normalizeCsvHeader)
  const dateIndex = pickHeaderIndex(headers, ['date', 'occurred_at', '日付'])
  const amountIndex = pickHeaderIndex(headers, ['amount', '金額'])
  const descriptionIndex = pickHeaderIndex(headers, ['description', 'memo', '摘要', '内容', '用途'])
  const counterpartyIndex = pickHeaderIndex(headers, ['counterparty', 'vendor', '取引先'])
  const directionIndex = pickHeaderIndex(headers, ['direction', 'type', '区分'])

  if (dateIndex < 0 || amountIndex < 0 || descriptionIndex < 0) return { rows: [], skipped: lines.length - 1 }

  const rows: CsvImportRow[] = []
  let skipped = 0

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line)
    const date = normalizeCsvDate(cells[dateIndex] ?? '')
    const amount = parseCurrencyNumber(cells[amountIndex] ?? '')
    const description = String(cells[descriptionIndex] ?? '').trim()
    if (!description || amount <= 0) {
      skipped += 1
      continue
    }

    const directionRaw = String(cells[directionIndex] ?? '').toLowerCase()
    const direction: 'income' | 'expense' =
      /income|sale|revenue|売上|収入/.test(directionRaw) ? 'income' : 'expense'

    rows.push({
      date,
      amount,
      description: description.slice(0, 200),
      counterparty: String(cells[counterpartyIndex] ?? '').trim().slice(0, 80),
      direction,
    })
  }

  return { rows, skipped }
}

function formatMoney(value: number, currency: string, locale?: 'ja' | 'en'): string {
  return formatMoneyI18n(value, currency, locale)
}

export default function FilingOrchestratorApp({ region, onSwitchRegion }: FilingOrchestratorAppProps) {
  const { user } = useUser()
  const { signOut } = useClerk()
  const { locale, setLocale, t } = useI18n()

  const [tab, setTab] = useState<TabKey>('transactions')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [showManualFallback, setShowManualFallback] = useState(false)

  const [mode, setMode] = useState<OperationMode>('tax_pro')
  const [status, setStatus] = useState<ConnectorStatus | null>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)

  const [records, setRecords] = useState<LocalRecord[]>([])
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([])
  const [isLoadingQueue, setIsLoadingQueue] = useState(false)
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)

  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [ledgerCsvFile, setLedgerCsvFile] = useState<File | null>(null)
  const [manualDate, setManualDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [manualAmount, setManualAmount] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualCounterparty, setManualCounterparty] = useState('')

  const [isSubmittingOcr, setIsSubmittingOcr] = useState(false)
  const [isSubmittingManual, setIsSubmittingManual] = useState(false)
  const [isSubmittingCsv, setIsSubmittingCsv] = useState(false)
  const [isPostingDraft, setIsPostingDraft] = useState(false)
  const [isAutoPosting, setIsAutoPosting] = useState(false)
  const [isStripeSyncing, setIsStripeSyncing] = useState(false)

  const provider = status?.provider ?? 'freee'
  const activeProviderStatus = status?.provider_status

  const postableCommands = useMemo<PostingCommand[]>(() => {
    return records
      .filter((record) => record.decision.rank === 'OK' && record.decision.is_expense && !record.posted?.ok)
      .map((record) => ({ transaction: record.transaction, decision: record.decision }))
  }, [records])

  const summary = useMemo(() => {
    const ok = records.filter((record) => record.decision.rank === 'OK').length
    const review = records.filter((record) => record.decision.rank === 'REVIEW').length
    const ng = records.filter((record) => record.decision.rank === 'NG').length
    return { total: records.length, ok, review, ng }
  }, [records])

  const reviewRecords = useMemo(() => records.filter((record) => record.decision.rank === 'REVIEW'), [records])

  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_STORAGE_KEY)
    if (saved) setMode(normalizeMode(saved))
  }, [])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    setShowManualFallback(query.get('manual') === '1')
  }, [])

  useEffect(() => {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode)
  }, [mode])

  const showApiNotice = (payload: {
    message: string
    diagnostic_code?: string
    next_action?: string
    contact?: string
    type?: 'success' | 'error'
  }) => {
    setNotice({
      type: payload.type ?? 'error',
      message: payload.message,
      code: payload.diagnostic_code,
      nextAction: payload.next_action,
      contact: payload.contact,
    })
  }

  const refreshStatus = async () => {
    setIsLoadingStatus(true)
    try {
      const response = await fetch(`/api/connectors/status?region=${region.code}&mode=${mode}`, { cache: 'no-store' })
      const data = (await response.json()) as {
        ok?: boolean
        status?: ConnectorStatus
        diagnostic_code?: string
        next_action?: string
        contact?: string
      }
      if (!response.ok || !data.ok || !data.status) {
        showApiNotice({
          message: '接続状態の取得に失敗しました。',
          diagnostic_code: data.diagnostic_code ?? String(response.status),
          next_action: data.next_action,
          contact: data.contact,
        })
        return
      }
      setStatus(data.status)
    } catch (error) {
      showApiNotice({
        message: `接続状態の取得に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        diagnostic_code: 'CONNECTORS_STATUS_FAILED',
      })
    } finally {
      setIsLoadingStatus(false)
    }
  }

  const refreshRecords = async () => {
    setIsLoadingRecords(true)
    try {
      const response = await fetch(
        `/api/transactions/list?region=${region.code}&mode=${mode}&limit=200`,
        { cache: 'no-store' }
      )
      const data = (await response.json()) as {
        ok?: boolean
        records?: LocalRecord[]
        diagnostic_code?: string
      }
      if (response.ok && data.ok && Array.isArray(data.records)) {
        setRecords(data.records)
      } else {
        setRecords([])
      }
    } catch {
      setRecords([])
    } finally {
      setIsLoadingRecords(false)
    }
  }

  const refreshQueue = async () => {
    setIsLoadingQueue(true)
    try {
      const response = await fetch(
        `/api/queue/review?limit=30&region=${region.code}&mode=${mode}&provider=${provider}`,
        { cache: 'no-store' }
      )
      const data = (await response.json()) as {
        ok?: boolean
        queue?: ReviewQueueItem[]
        diagnostic_code?: string
        next_action?: string
        contact?: string
      }

      if (!response.ok || !data.ok || !Array.isArray(data.queue)) {
        showApiNotice({
          message: 'レビューキュー取得に失敗しました。',
          diagnostic_code: data.diagnostic_code ?? String(response.status),
          next_action: data.next_action,
          contact: data.contact,
        })
        setReviewQueue([])
        return
      }

      setReviewQueue(data.queue)
    } catch (error) {
      showApiNotice({
        message: `レビューキュー取得に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        diagnostic_code: 'REVIEW_QUEUE_FAILED',
      })
      setReviewQueue([])
    } finally {
      setIsLoadingQueue(false)
    }
  }

  useEffect(() => {
    void refreshStatus()
    void refreshRecords()
    setReviewQueue([])
    setNotice(null)
  }, [region.code, mode])

  useEffect(() => {
    if (!status) return
    void refreshQueue()
  }, [status?.provider])

  const addRecord = (transaction: CanonicalTransaction, decision: ClassificationDecision) => {
    setRecords((prev) => [{ transaction, decision }, ...prev])
  }

  const handleOcrIntake = async () => {
    if (!receiptFile) {
      showApiNotice({ message: 'レシート画像を選択してください。', diagnostic_code: 'RECEIPT_REQUIRED' })
      return
    }

    setIsSubmittingOcr(true)
    setNotice(null)
    try {
      const imageDataUrl = await fileToDataUrl(receiptFile)
      const response = await fetch('/api/intake/ocr-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, country_code: region.countryCode }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        transaction?: CanonicalTransaction
        decision?: ClassificationDecision
        diagnostic_code?: string
      }
      if (!response.ok || !data.ok || !data.transaction || !data.decision) {
        showApiNotice({
          message: 'OCR取込に失敗しました。',
          diagnostic_code: data.diagnostic_code ?? String(response.status),
          next_action: '画像の再撮影または手入力で再試行してください。',
        })
        return
      }
      addRecord(data.transaction, data.decision)
      setReceiptFile(null)
      setNotice({ type: 'success', message: `OCR取込完了: ${data.decision.rank} / ${data.decision.category}` })
    } catch (error) {
      showApiNotice({
        message: `OCR取込に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        diagnostic_code: 'INTAKE_OCR_FAILED',
      })
    } finally {
      setIsSubmittingOcr(false)
    }
  }

  const handleManualIntake = async (event: React.FormEvent) => {
    event.preventDefault()
    const amount = Number(manualAmount)
    if (!manualDescription.trim() || !Number.isFinite(amount) || amount <= 0) {
      showApiNotice({
        message: '日付・金額・内容を確認してください。',
        diagnostic_code: 'INVALID_MANUAL_INPUT',
      })
      return
    }

    setIsSubmittingManual(true)
    setNotice(null)
    try {
      const response = await fetch('/api/intake/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: manualDate,
          amount,
          description: manualDescription,
          counterparty: manualCounterparty,
          direction: 'expense',
          source_type: 'manual',
          country_code: region.countryCode,
        }),
      })

      const data = (await response.json()) as {
        ok?: boolean
        transaction?: CanonicalTransaction
        decision?: ClassificationDecision
        diagnostic_code?: string
      }

      if (!response.ok || !data.ok || !data.transaction || !data.decision) {
        showApiNotice({
          message: '手入力取込に失敗しました。',
          diagnostic_code: data.diagnostic_code ?? String(response.status),
          next_action: '入力項目を見直して再試行してください。',
        })
        return
      }

      addRecord(data.transaction, data.decision)
      setManualAmount('')
      setManualDescription('')
      setManualCounterparty('')
      setNotice({ type: 'success', message: `手入力取込完了: ${data.decision.rank} / ${data.decision.category}` })
    } catch (error) {
      showApiNotice({
        message: `手入力取込に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        diagnostic_code: 'INTAKE_MANUAL_FAILED',
      })
    } finally {
      setIsSubmittingManual(false)
    }
  }

  const handleCsvImport = async () => {
    if (!ledgerCsvFile) {
      showApiNotice({
        message: '帳簿CSVファイルを選択してください。',
        diagnostic_code: 'LEDGER_CSV_REQUIRED',
      })
      return
    }

    setIsSubmittingCsv(true)
    setNotice(null)

    try {
      const fileText = await ledgerCsvFile.text()
      const { rows, skipped } = parseLedgerCsv(fileText)
      if (rows.length === 0) {
        showApiNotice({
          message: 'CSVに有効な取引行がありません。',
          diagnostic_code: 'LEDGER_CSV_INVALID',
          next_action: 'date, amount, description列を含むCSVを使用してください。',
        })
        return
      }

      let success = 0
      let failed = 0
      let lastErrorCode = ''

      for (const row of rows.slice(0, 200)) {
        const response = await fetch('/api/intake/manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: row.date,
            amount: row.amount,
            description: row.description,
            counterparty: row.counterparty,
            direction: row.direction,
            source_type: 'connector_api',
            country_code: region.countryCode,
          }),
        })

        const data = (await response.json()) as {
          ok?: boolean
          transaction?: CanonicalTransaction
          decision?: ClassificationDecision
          diagnostic_code?: string
        }

        if (response.ok && data.ok && data.transaction && data.decision) {
          addRecord(data.transaction, data.decision)
          success += 1
        } else {
          failed += 1
          lastErrorCode = data.diagnostic_code ?? String(response.status)
        }
      }

      setLedgerCsvFile(null)
      setNotice({
        type: failed === 0 ? 'success' : 'error',
        message: `帳簿インポート完了: 成功 ${success} / 失敗 ${failed} / スキップ ${skipped}`,
        code: lastErrorCode || undefined,
        nextAction: rows.length > 200 ? '1回の取込は200件までです。残りは分割してください。' : undefined,
      })
    } catch (error) {
      showApiNotice({
        message: `帳簿インポートに失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        diagnostic_code: 'LEDGER_CSV_IMPORT_FAILED',
      })
    } finally {
      setIsSubmittingCsv(false)
    }
  }

  const updateDecision = (transactionId: string, patch: Partial<ClassificationDecision>) => {
    setRecords((prev) =>
      prev.map((record) =>
        record.transaction.transaction_id === transactionId
          ? { ...record, decision: { ...record.decision, ...patch } }
          : record
      )
    )
  }

  const reevaluateDecision = async (transaction: CanonicalTransaction) => {
    setNotice(null)
    try {
      const response = await fetch('/api/decision/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        decision?: ClassificationDecision
        diagnostic_code?: string
      }
      if (!response.ok || !data.ok || !data.decision) {
        showApiNotice({
          message: '再判定に失敗しました。',
          diagnostic_code: data.diagnostic_code ?? String(response.status),
          next_action: '判定理由を編集して再送信してください。',
        })
        return
      }
      updateDecision(transaction.transaction_id, data.decision)
      setNotice({ type: 'success', message: '再判定を反映しました。' })
    } catch (error) {
      showApiNotice({
        message: `再判定に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        diagnostic_code: 'DECISION_EVALUATE_FAILED',
      })
    }
  }

  const startProviderConnect = () => {
    const query = new URLSearchParams({
      region: region.code,
      mode,
      provider,
      return_to: `${window.location.pathname}?region=${region.code}`,
    })
    window.location.href = `/api/connectors/oauth/start?${query.toString()}`
  }

  const disconnectProvider = async () => {
    try {
      const response = await fetch('/api/connectors/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, region: region.code, return_to: '/' }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        redirect_to?: string
        diagnostic_code?: string
        next_action?: string
        contact?: string
      }
      if (!response.ok || !data.ok) {
        showApiNotice({
          message: '連携解除に失敗しました。',
          diagnostic_code: data.diagnostic_code ?? String(response.status),
          next_action: data.next_action,
          contact: data.contact,
        })
        return
      }

      if (data.redirect_to) {
        window.location.href = data.redirect_to
        return
      }

      setNotice({ type: 'success', message: '連携を解除しました。' })
      await refreshStatus()
      await refreshQueue()
    } catch (error) {
      showApiNotice({
        message: `連携解除に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        diagnostic_code: 'CONNECTOR_DISCONNECT_FAILED',
      })
    }
  }

  const postDrafts = async () => {
    if (postableCommands.length === 0) {
      showApiNotice({
        message: '送信対象（OK）がありません。',
        diagnostic_code: 'NO_POSTABLE_COMMANDS',
      })
      return
    }

    setIsPostingDraft(true)
    setNotice(null)
    try {
      const response = await fetch('/api/posting/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region: region.code,
          mode,
          provider,
          commands: postableCommands,
        }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        success?: number
        failed?: number
        results?: PostingResult[]
        diagnostic_code?: string
        next_action?: string
        contact?: string
      }

      if (!Array.isArray(data.results)) {
        showApiNotice({
          message: '下書き送信に失敗しました。',
          diagnostic_code: data.diagnostic_code ?? String(response.status),
          next_action: data.next_action,
          contact: data.contact,
        })
        return
      }

      const resultMap = new Map(data.results.map((row) => [row.transaction_id, row]))
      setRecords((prev) =>
        prev.map((record) => {
          const posted = resultMap.get(record.transaction.transaction_id)
          return posted ? { ...record, posted } : record
        })
      )

      setNotice({
        type: (data.failed ?? 0) === 0 ? 'success' : 'error',
        message: `${activeProviderStatus?.label ?? provider} 下書き送信: 成功 ${data.success ?? 0} / 失敗 ${data.failed ?? 0}`,
        code: data.diagnostic_code,
        nextAction: data.next_action,
        contact: data.contact,
      })

      await refreshQueue()
      await refreshStatus()
    } catch (error) {
      showApiNotice({
        message: `下書き送信に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        diagnostic_code: 'POSTING_DRAFT_FAILED',
      })
    } finally {
      setIsPostingDraft(false)
    }
  }

  const runAutoPost = async () => {
    setIsAutoPosting(true)
    setNotice(null)
    try {
      const response = await fetch('/api/auto-post/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: region.code, mode, provider, min_confidence: 0.85 }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        success?: number
        failed?: number
        results?: PostingResult[]
        message?: string
        diagnostic_code?: string
      }
      if (!response.ok || !data.ok) {
        showApiNotice({
          message: data.message ?? '自動送信に失敗しました。',
          diagnostic_code: data.diagnostic_code ?? String(response.status),
        })
        return
      }
      setNotice({
        type: (data.failed ?? 0) === 0 ? 'success' : 'error',
        message: data.message ?? `自動送信: 成功 ${data.success ?? 0} / 失敗 ${data.failed ?? 0}`,
      })
      await refreshRecords()
      await refreshQueue()
    } catch (error) {
      showApiNotice({
        message: `自動送信に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
        diagnostic_code: 'AUTO_POST_FAILED',
      })
    } finally {
      setIsAutoPosting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
        <header className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 md:px-7">
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-xl"
                style={{ backgroundImage: `linear-gradient(135deg, ${region.accentFrom} 0%, ${region.accentTo} 100%)` }}
              />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tax man</p>
                <h1 className="text-2xl font-bold text-slate-900">{t('common', 'taxWorkflow')}</h1>
                <p className="text-sm text-slate-500">{user?.primaryEmailAddress?.emailAddress ?? '-'}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex gap-1">
                {(['ja', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLocale(l)}
                    className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
                      locale === l ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </span>
              <button
                onClick={onSwitchRegion}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              >
                {t('common', 'regionChange')}
              </button>
              <button
                onClick={() => void signOut()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              >
                {t('common', 'logout')}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-5 py-3 md:px-7">
            <button
              onClick={() => setTab('transactions')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                tab === 'transactions' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              {t('common', 'transactions')}
            </button>
            <button
              onClick={() => setTab('queue')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                tab === 'queue' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              {t('common', 'reviewSend')}
            </button>
            <button
              onClick={() => void refreshStatus()}
              disabled={isLoadingStatus}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:bg-slate-100"
            >
              {isLoadingStatus ? '...' : t('common', 'statusUpdate')}
            </button>
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              {region.code} / {region.currency}
            </span>
          </div>

          {notice && (
            <div
              className={`mx-5 mb-4 rounded-xl border px-4 py-3 text-sm md:mx-7 ${
                notice.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              <p>{notice.message}</p>
              {notice.code && <p className="mt-1 text-xs font-semibold">Error Code: {notice.code}</p>}
              {notice.nextAction && <p className="mt-1 text-xs">Next Action: {notice.nextAction}</p>}
              {notice.contact && <p className="mt-1 text-xs">Provider Contact: {notice.contact}</p>}
            </div>
          )}
        </header>

        {tab === 'transactions' && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
              <p className="text-sm text-slate-700">管轄地域</p>
              <p className="text-3xl font-bold text-slate-900">{region.name}</p>
              <p className="mt-1 text-sm text-slate-600">
                {region.code} / {region.currency} ・ {activeProviderStatus?.label ?? provider} ・
                {activeProviderStatus?.connected ? ' 接続済み' : ' 未接続'}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-600">アップロード済み</p>
                <p className="text-3xl font-bold text-slate-900">{summary.total}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                <p className="text-sm text-emerald-700">合計金額（参考）</p>
                <p className="text-3xl font-bold text-emerald-700">
                  {formatMoney(records.reduce((acc, item) => acc + item.transaction.amount, 0), region.currency, locale)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-slate-600">処理完了（OK）</p>
                <p className="text-3xl font-bold text-slate-900">{summary.ok}</p>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-blue-50 p-2 text-blue-600">
                    <ScanLine className="h-5 w-5" />
                  </div>
                  <div className="w-full">
                    <h3 className="text-3xl font-bold tracking-tight text-slate-900">レシート・帳簿をアップロード</h3>
                    <p className="mt-1 text-lg text-slate-500">画像またはCSVを投入するだけ。入力は不要です。</p>
                    <div className="mt-4 rounded-xl border-2 border-dashed border-slate-300 p-4">
                      <p className="text-sm font-semibold text-slate-700">画像アップロード</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                          className="rounded-lg border border-slate-300 bg-white p-2 text-sm"
                        />
                        <button
                          onClick={handleOcrIntake}
                          disabled={isSubmittingOcr}
                          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
                        >
                          {isSubmittingOcr ? '処理中...' : '画像を解析'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-700">Stripe決済同期</p>
                      <div className="mt-2">
                        <button
                          onClick={async () => {
                            setIsStripeSyncing(true)
                            setNotice(null)
                            try {
                              const res = await fetch('/api/connectors/stripe/sync', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ region: region.code, limit: 50 }),
                              })
                              const data = (await res.json()) as { ok?: boolean; processed?: number; message?: string }
                              setNotice({
                                type: data.ok ? 'success' : 'error',
                                message: data.message ?? (data.ok ? '同期完了' : '同期失敗'),
                              })
                              if (data.ok) await refreshRecords()
                            } catch (e) {
                              showApiNotice({ message: `Stripe同期失敗: ${e}`, diagnostic_code: 'STRIPE_SYNC_FAILED' })
                            } finally {
                              setIsStripeSyncing(false)
                            }
                          }}
                          disabled={isStripeSyncing}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:bg-slate-100"
                        >
                          {isStripeSyncing ? '同期中...' : 'Stripe取引を同期'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl border border-slate-200 p-4">
                      <p className="text-sm font-semibold text-slate-700">デジタル帳簿インポート（CSV）</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          onChange={(event) => setLedgerCsvFile(event.target.files?.[0] ?? null)}
                          className="rounded-lg border border-slate-300 bg-white p-2 text-sm"
                        />
                        <button
                          onClick={handleCsvImport}
                          disabled={isSubmittingCsv}
                          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:bg-slate-100"
                        >
                          {isSubmittingCsv ? '取込中...' : 'CSVを取込'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={startProviderConnect}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
                      >
                        {activeProviderStatus?.label ?? provider}連携
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-emerald-50 p-2 text-emerald-700">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900">申告書を確認・生成</h3>
                      <p className="mt-1 text-lg text-slate-500">要確認だけ直して、税理士チェック用の下書きを作成。</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-slate-600">
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <span>要確認</span>
                      <span className="font-semibold">{summary.review}件</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <span>NG</span>
                      <span className="font-semibold">{summary.ng}件</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setTab('queue')}
                    className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
                  >
                    確認画面へ
                  </button>
                </div>

                {showManualFallback && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900">手入力（非常時のみ）</h3>
                    <form onSubmit={handleManualIntake} className="mt-3 grid gap-3 md:grid-cols-2">
                      <input
                        type="date"
                        value={manualDate}
                        onChange={(event) => setManualDate(event.target.value)}
                        className="rounded-lg border border-slate-300 p-2"
                        required
                      />
                      <input
                        type="number"
                        min={1}
                        value={manualAmount}
                        onChange={(event) => setManualAmount(event.target.value)}
                        placeholder="金額"
                        className="rounded-lg border border-slate-300 p-2"
                        required
                      />
                      <input
                        type="text"
                        value={manualCounterparty}
                        onChange={(event) => setManualCounterparty(event.target.value)}
                        placeholder="取引先（任意）"
                        className="rounded-lg border border-slate-300 p-2"
                      />
                      <input
                        type="text"
                        value={manualDescription}
                        onChange={(event) => setManualDescription(event.target.value)}
                        placeholder="用途・内容"
                        className="rounded-lg border border-slate-300 p-2"
                        required
                      />
                      <button
                        type="submit"
                        disabled={isSubmittingManual}
                        className="md:col-span-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
                      >
                        {isSubmittingManual ? '判定中...' : '手入力を確認一覧へ追加'}
                      </button>
                    </form>
                  </div>
                )}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900">この画面でやること</h3>
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                      <p className="text-slate-700">まず画像かCSVのどちらかでデータを取込</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                      <p className="text-slate-700">確認・送信で要確認だけ修正</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                      <p className="text-slate-700">OKのみを会計下書きへ一括送信</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 shadow-sm">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-5 w-5" />
                <p>
                  この画面のアップロード処理では証憑画像を永続保存しません。最終税務判断の責任は税理士等の専門家にあります。
                </p>
              </div>
            </div>
          </section>
        )}

        {tab === 'queue' && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">確認・送信</h2>
                  <p className="text-sm text-slate-500">要確認だけ修正して、OKを会計へ下書き送信します。</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void refreshQueue()}
                    disabled={isLoadingQueue}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100"
                  >
                    {isLoadingQueue ? '取得中...' : '連携先の下書きを同期'}
                  </button>
                  <button
                    onClick={postDrafts}
                    disabled={isPostingDraft || postableCommands.length === 0}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
                  >
                    {isPostingDraft ? t('common', 'sending') : `${t('common', 'sendDrafts')} (${postableCommands.length})`}
                  </button>
                  <button
                    onClick={runAutoPost}
                    disabled={isAutoPosting || !activeProviderStatus?.connected}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:bg-slate-100"
                  >
                    {isAutoPosting ? t('common', 'autoSending') : t('common', 'autoSend')}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-bold text-slate-900">要確認一覧（REVIEWのみ）</h3>
              <div className="mt-3 space-y-3">
                {reviewRecords.length === 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">まだ取り込まれた取引がありません。</p>
                ) : (
                  reviewRecords.map((record) => (
                    <div key={record.transaction.transaction_id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {record.transaction.occurred_at} / {formatMoney(record.transaction.amount, region.currency, locale)} / {record.transaction.memo_redacted}
                        </p>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-bold ${
                            record.decision.rank === 'OK'
                              ? 'bg-emerald-100 text-emerald-700'
                              : record.decision.rank === 'NG'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {record.decision.rank}
                        </span>
                      </div>

                      <div className="mt-2 grid gap-2 md:grid-cols-4">
                        <input
                          type="text"
                          value={record.decision.category}
                          onChange={(event) =>
                            updateDecision(record.transaction.transaction_id, { category: event.target.value })
                          }
                          className="rounded-md border border-slate-300 p-2 text-xs"
                        />
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step="0.01"
                          value={record.decision.allocation_rate}
                          onChange={(event) =>
                            updateDecision(record.transaction.transaction_id, {
                              allocation_rate: Math.max(0, Math.min(1, Number(event.target.value || 0))),
                            })
                          }
                          className="rounded-md border border-slate-300 p-2 text-xs"
                        />
                        <select
                          value={record.decision.rank}
                          onChange={(event) =>
                            updateDecision(record.transaction.transaction_id, {
                              rank: event.target.value as ClassificationDecision['rank'],
                              is_expense: event.target.value !== 'NG',
                            })
                          }
                          className="rounded-md border border-slate-300 p-2 text-xs"
                        >
                          <option value="OK">OK</option>
                          <option value="REVIEW">REVIEW</option>
                          <option value="NG">NG</option>
                        </select>
                        <button
                          onClick={() => void reevaluateDecision(record.transaction)}
                          className="rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-semibold"
                        >
                          再判定
                        </button>
                      </div>

                      <textarea
                        value={record.decision.reason}
                        onChange={(event) =>
                          updateDecision(record.transaction.transaction_id, { reason: event.target.value.slice(0, 240) })
                        }
                        className="mt-2 w-full rounded-md border border-slate-300 p-2 text-xs"
                        rows={2}
                      />

                      {record.posted ? (
                        <p className={`mt-2 text-xs ${record.posted.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                          {record.posted.ok
                            ? `送信済み (${record.posted.provider ?? provider}: ${record.posted.remote_id ?? '-'})`
                            : `送信失敗 (${record.posted.diagnostic_code})`}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-bold text-slate-900">会計下書き一覧（Tax man作成分）</h3>
              <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="p-2 text-left">Provider</th>
                      <th className="p-2 text-left">ID</th>
                      <th className="p-2 text-left">日付</th>
                      <th className="p-2 text-right">金額</th>
                      <th className="p-2 text-left">状態</th>
                      <th className="p-2 text-left">メモ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewQueue.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-3 text-center text-slate-500">
                          レビューキューがありません。
                        </td>
                      </tr>
                    ) : (
                      reviewQueue.map((row, index) => (
                        <tr key={`${row.provider}-${row.id ?? 'n'}-${index}`} className="border-t border-slate-100">
                          <td className="p-2">{row.provider}</td>
                          <td className="p-2">{row.id ?? '-'}</td>
                          <td className="p-2">{row.issue_date || '-'}</td>
                          <td className="p-2 text-right">{formatMoney(row.amount, row.currency ?? region.currency, locale)}</td>
                          <td className="p-2">{row.status || '-'}</td>
                          <td className="p-2">{row.memo || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
