'use client'

import { useEffect, useMemo, useState } from 'react'
import { useClerk, useUser } from '@clerk/nextjs'

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

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

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

export default function FilingOrchestratorApp({ region, onSwitchRegion }: FilingOrchestratorAppProps) {
  const { user } = useUser()
  const { signOut } = useClerk()

  const [tab, setTab] = useState<TabKey>('transactions')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showManualFallback, setShowManualFallback] = useState(false)

  const [mode, setMode] = useState<OperationMode>('tax_pro')
  const [status, setStatus] = useState<ConnectorStatus | null>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)

  const [records, setRecords] = useState<LocalRecord[]>([])
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([])
  const [isLoadingQueue, setIsLoadingQueue] = useState(false)

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

  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_STORAGE_KEY)
    if (saved) setMode(normalizeMode(saved))
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
    setRecords([])
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

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
        <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
          <div
            className="px-5 py-6 text-white md:px-8"
            style={{ backgroundImage: `linear-gradient(135deg, ${region.accentFrom} 0%, ${region.accentTo} 100%)` }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">Tax man</p>
                <h1 className="mt-1 text-3xl font-black">{region.uxLabel}</h1>
                <p className="mt-2 text-sm text-white/90">{region.description}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSettings((prev) => !prev)}
                  className="rounded-xl border border-white/35 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
                >
                  設定
                </button>
                <button
                  onClick={onSwitchRegion}
                  className="rounded-xl border border-white/35 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
                >
                  地域変更
                </button>
                <button
                  onClick={() => void signOut()}
                  className="rounded-xl border border-white/35 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
                >
                  ログアウト
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs text-white/80">{user?.primaryEmailAddress?.emailAddress ?? ''}</p>
          </div>

          {showSettings && (
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 md:px-8">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-sm font-semibold text-slate-700">
                  運用モード
                  <select
                    value={mode}
                    onChange={(event) => setMode(normalizeMode(event.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2"
                  >
                    <option value="tax_pro">Tax Pro（税理士主導）</option>
                    <option value="direct">Direct（店舗直販）</option>
                  </select>
                </label>
                <label className="rounded-lg border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={showManualFallback}
                    onChange={(event) => setShowManualFallback(event.target.checked)}
                    className="mr-2 align-middle"
                  />
                  非常時のみ手入力フォームを表示
                  <p className="mt-1 text-xs font-normal text-slate-500">通常運用では非表示のままにしてください。</p>
                </label>
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
                  本サービスは税務判断を補助するツールです。最終判断・申告責任は税理士等の専門家にあります。
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3 md:px-8">
            <button
              onClick={() => setTab('transactions')}
              className={`rounded-xl px-4 py-2 text-sm font-bold ${
                tab === 'transactions'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              取引取込
            </button>
            <button
              onClick={() => setTab('queue')}
              className={`rounded-xl px-4 py-2 text-sm font-bold ${
                tab === 'queue' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              判定キュー
            </button>
            <button
              onClick={() => void refreshStatus()}
              disabled={isLoadingStatus}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:bg-slate-100"
            >
              {isLoadingStatus ? '更新中...' : '状態更新'}
            </button>
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {region.code} / {region.currency} / {mode === 'tax_pro' ? 'Tax Pro' : 'Direct'}
            </span>
          </div>
          <div className="border-t border-slate-200 bg-amber-50 px-5 py-2 text-xs text-amber-900 md:px-8">
            税務判断の最終責任は税理士等の専門家にあります。Tax manは判定補助と下書き作成を行います。
          </div>

          {notice && (
            <div
              className={`mx-5 mb-4 rounded-xl border px-3 py-2 text-sm md:mx-8 ${
                notice.type === 'success'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-red-300 bg-red-50 text-red-800'
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
          <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-slate-900">OCR取込</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={startProviderConnect}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white"
                    >
                      {activeProviderStatus?.label ?? provider}連携
                    </button>
                    <button
                      onClick={() => void disconnectProvider()}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                    >
                      連携解除
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-sm text-slate-600">証憑は処理のためだけに使用し、サーバーには永続保存しません。</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
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
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400"
                  >
                    {isSubmittingOcr ? '処理中...' : 'OCR取込して判定'}
                  </button>
                </div>
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <p className="text-sm font-semibold text-slate-900">デジタル帳簿インポート（CSV）</p>
                  <p className="mt-1 text-xs text-slate-500">列名は `date, amount, description` を含めてください。最大200件/回。</p>
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
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400"
                    >
                      {isSubmittingCsv ? '取込中...' : '帳簿をインポート'}
                    </button>
                  </div>
                </div>
              </div>

              {showManualFallback && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900">手入力取込</h2>
                <p className="mt-1 text-sm text-slate-600">非常時の代替入力です。通常はOCRまたは帳簿インポートを使ってください。</p>

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
                    className="md:col-span-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400"
                  >
                    {isSubmittingManual ? '判定中...' : '手入力を判定キューへ追加'}
                  </button>
                </form>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900">今回の取込結果</h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="text-xs text-slate-500">Total</p>
                    <p className="text-xl font-black">{summary.total}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3 text-sm">
                    <p className="text-xs text-slate-500">OK</p>
                    <p className="text-xl font-black text-emerald-700">{summary.ok}</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-3 text-sm">
                    <p className="text-xs text-slate-500">Review</p>
                    <p className="text-xl font-black text-amber-700">{summary.review}</p>
                  </div>
                  <div className="rounded-lg bg-red-50 p-3 text-sm">
                    <p className="text-xs text-slate-500">NG</p>
                    <p className="text-xl font-black text-red-700">{summary.ng}</p>
                  </div>
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">地域プラットフォーム</h3>
                <div className="mt-3 grid gap-2">
                  {(status?.region?.platforms ?? region.platforms).map((platform) => (
                    <div key={platform.key} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-semibold text-slate-800">{platform.name}</span>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          platform.status === 'ready'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {platform.status === 'ready' ? 'Ready' : 'Planned'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">連携状態</h3>
                <div className="mt-2 space-y-2 text-sm">
                  <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                    <span>会計</span>
                    <span className={activeProviderStatus?.connected ? 'font-bold text-emerald-700' : 'font-bold text-red-700'}>
                      {activeProviderStatus?.label ?? provider} / {activeProviderStatus?.connected ? '接続済み' : '未接続'}
                    </span>
                  </div>
                  <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                    <span>OCR</span>
                    <span className={status?.ocr.enabled ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>
                      {status?.ocr.enabled ? '有効' : '無効'}
                    </span>
                  </div>
                  <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                    <span>接続方式</span>
                    <span className="font-semibold text-slate-700">
                      {activeProviderStatus?.mode === 'shared_token' ? '共通トークン' : 'ユーザーOAuth'}
                    </span>
                  </div>
                </div>
              </div>
            </aside>
          </section>
        )}

        {tab === 'queue' && (
          <section className="mt-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">判定キュー</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => void refreshQueue()}
                    disabled={isLoadingQueue}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100"
                  >
                    {isLoadingQueue ? '取得中...' : '会計下書きを取得'}
                  </button>
                  <button
                    onClick={postDrafts}
                    disabled={isPostingDraft || postableCommands.length === 0}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-400"
                  >
                    {isPostingDraft ? '送信中...' : `OKを下書き送信 (${postableCommands.length})`}
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {records.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">まだ取り込まれた取引がありません。</p>
                ) : (
                  records.map((record) => (
                    <div key={record.transaction.transaction_id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {record.transaction.occurred_at} / {formatMoney(record.transaction.amount, region.currency)} / {record.transaction.memo_redacted}
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
              <h3 className="text-base font-bold text-slate-900">会計下書きキュー</h3>
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
                          <td className="p-2 text-right">{formatMoney(row.amount, row.currency ?? region.currency)}</td>
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
