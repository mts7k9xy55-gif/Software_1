'use client'

import { useEffect, useMemo, useState } from 'react'
import { useClerk, useUser } from '@clerk/nextjs'

import type { CanonicalTransaction, ClassificationDecision, PostingCommand, PostingResult } from '@/lib/core/types'

type TabKey = 'transactions' | 'queue'

type Notice = {
  type: 'success' | 'error'
  message: string
}

type LocalRecord = {
  transaction: CanonicalTransaction
  decision: ClassificationDecision
  posted?: PostingResult
}

type ConnectorStatus = {
  freee: {
    configured: boolean
    connected: boolean
    companyId: number | null
    nextAction: string
    mode?: 'shared_token' | 'oauth_per_user'
  }
  ocr: {
    enabled: boolean
    provider: string
  }
  llm: {
    externalEnabled: boolean
    model: string
  }
  packs: Array<{ key: string; title: string }>
  support_boundary: {
    owner_scope: string
    freee_scope: string
  }
}

type FreeeQueueRow = {
  id: number | null
  issue_date: string
  amount: number
  status: string
  memo: string
}

function formatYen(value: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
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

export default function FilingOrchestratorApp() {
  const { user } = useUser()
  const { signOut } = useClerk()

  const [tab, setTab] = useState<TabKey>('transactions')
  const [notice, setNotice] = useState<Notice | null>(null)

  const [status, setStatus] = useState<ConnectorStatus | null>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)

  const [records, setRecords] = useState<LocalRecord[]>([])
  const [freeeQueue, setFreeeQueue] = useState<FreeeQueueRow[]>([])
  const [isLoadingQueue, setIsLoadingQueue] = useState(false)

  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [manualDate, setManualDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [manualAmount, setManualAmount] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualCounterparty, setManualCounterparty] = useState('')

  const [isSubmittingOcr, setIsSubmittingOcr] = useState(false)
  const [isSubmittingManual, setIsSubmittingManual] = useState(false)
  const [isPostingDraft, setIsPostingDraft] = useState(false)

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

  const refreshStatus = async () => {
    setIsLoadingStatus(true)
    try {
      const response = await fetch('/api/connectors/status', { cache: 'no-store' })
      const data = (await response.json()) as { ok?: boolean; status?: ConnectorStatus; diagnostic_code?: string }
      if (!response.ok || !data.ok || !data.status) {
        setNotice({ type: 'error', message: `接続状態の取得に失敗しました (${data.diagnostic_code ?? response.status})` })
        return
      }
      setStatus(data.status)
    } catch (error) {
      setNotice({
        type: 'error',
        message: `接続状態の取得に失敗しました: ${error instanceof Error ? error.message : 'unknown'}`,
      })
    } finally {
      setIsLoadingStatus(false)
    }
  }

  const refreshFreeeQueue = async () => {
    setIsLoadingQueue(true)
    try {
      const response = await fetch('/api/queue/review?limit=30', { cache: 'no-store' })
      const data = (await response.json()) as {
        ok?: boolean
        queue?: FreeeQueueRow[]
        diagnostic_code?: string
        message?: string
      }
      if (!response.ok || !data.ok || !Array.isArray(data.queue)) {
        setNotice({
          type: 'error',
          message: `freeeレビュー取得に失敗しました (${data.diagnostic_code ?? response.status})`,
        })
        return
      }
      setFreeeQueue(data.queue)
    } catch (error) {
      setNotice({ type: 'error', message: `freeeレビュー取得に失敗しました: ${error instanceof Error ? error.message : 'unknown'}` })
    } finally {
      setIsLoadingQueue(false)
    }
  }

  useEffect(() => {
    void refreshStatus()
    void refreshFreeeQueue()
  }, [])

  const addRecord = (transaction: CanonicalTransaction, decision: ClassificationDecision) => {
    setRecords((prev) => [{ transaction, decision }, ...prev])
  }

  const handleOcrIntake = async () => {
    if (!receiptFile) {
      setNotice({ type: 'error', message: 'レシート画像を選択してください。' })
      return
    }
    setIsSubmittingOcr(true)
    setNotice(null)
    try {
      const imageDataUrl = await fileToDataUrl(receiptFile)
      const response = await fetch('/api/intake/ocr-classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, country_code: 'JP' }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        transaction?: CanonicalTransaction
        decision?: ClassificationDecision
        diagnostic_code?: string
        message?: string
      }
      if (!response.ok || !data.ok || !data.transaction || !data.decision) {
        setNotice({ type: 'error', message: `OCR取込に失敗しました (${data.diagnostic_code ?? response.status})` })
        return
      }
      addRecord(data.transaction, data.decision)
      setReceiptFile(null)
      setNotice({ type: 'success', message: `OCR取込完了: ${data.decision.rank} / ${data.decision.category}` })
    } catch (error) {
      setNotice({ type: 'error', message: `OCR取込に失敗しました: ${error instanceof Error ? error.message : 'unknown'}` })
    } finally {
      setIsSubmittingOcr(false)
    }
  }

  const handleManualIntake = async (event: React.FormEvent) => {
    event.preventDefault()
    const amount = Number(manualAmount)
    if (!manualDescription.trim() || !Number.isFinite(amount) || amount <= 0) {
      setNotice({ type: 'error', message: '日付・金額・内容を確認してください。' })
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
          country_code: 'JP',
        }),
      })

      const data = (await response.json()) as {
        ok?: boolean
        transaction?: CanonicalTransaction
        decision?: ClassificationDecision
        diagnostic_code?: string
      }

      if (!response.ok || !data.ok || !data.transaction || !data.decision) {
        setNotice({ type: 'error', message: `手入力取込に失敗しました (${data.diagnostic_code ?? response.status})` })
        return
      }

      addRecord(data.transaction, data.decision)
      setManualAmount('')
      setManualDescription('')
      setManualCounterparty('')
      setNotice({ type: 'success', message: `手入力取込完了: ${data.decision.rank} / ${data.decision.category}` })
    } catch (error) {
      setNotice({ type: 'error', message: `手入力取込に失敗しました: ${error instanceof Error ? error.message : 'unknown'}` })
    } finally {
      setIsSubmittingManual(false)
    }
  }

  const updateDecision = (transactionId: string, patch: Partial<ClassificationDecision>) => {
    setRecords((prev) =>
      prev.map((record) =>
        record.transaction.transaction_id === transactionId
          ? {
              ...record,
              decision: {
                ...record.decision,
                ...patch,
              },
            }
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
        setNotice({ type: 'error', message: `再判定に失敗しました (${data.diagnostic_code ?? response.status})` })
        return
      }
      updateDecision(transaction.transaction_id, data.decision)
      setNotice({ type: 'success', message: '再判定を反映しました。' })
    } catch (error) {
      setNotice({ type: 'error', message: `再判定に失敗しました: ${error instanceof Error ? error.message : 'unknown'}` })
    }
  }

  const postDrafts = async () => {
    if (postableCommands.length === 0) {
      setNotice({ type: 'error', message: 'freee送信対象（OK）がありません。' })
      return
    }

    setIsPostingDraft(true)
    setNotice(null)
    try {
      const response = await fetch('/api/posting/freee/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: postableCommands }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        success?: number
        failed?: number
        results?: PostingResult[]
        diagnostic_code?: string
      }

      if (!response.ok || !data.ok || !Array.isArray(data.results)) {
        setNotice({ type: 'error', message: `freee送信に失敗しました (${data.diagnostic_code ?? response.status})` })
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
        message: `freee下書き送信: 成功 ${data.success ?? 0} / 失敗 ${data.failed ?? 0}`,
      })
      await refreshFreeeQueue()
      await refreshStatus()
    } catch (error) {
      setNotice({ type: 'error', message: `freee送信に失敗しました: ${error instanceof Error ? error.message : 'unknown'}` })
    } finally {
      setIsPostingDraft(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto w-full max-w-6xl p-4">
        <header className="sticky top-0 z-10 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black text-slate-900">Tax man</h1>
              <p className="text-sm text-slate-500">店主入力を最小化し、税理士の最終チェックに集中する運用</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{user?.primaryEmailAddress?.emailAddress ?? ''}</span>
              <button
                onClick={() => void signOut()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
              >
                ログアウト
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setTab('transactions')}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${
                tab === 'transactions'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              取引取込
            </button>
            <button
              onClick={() => setTab('queue')}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${
                tab === 'queue' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              判定キュー
            </button>
            <button
              onClick={() => void refreshStatus()}
              disabled={isLoadingStatus}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:bg-slate-100"
            >
              {isLoadingStatus ? '更新中...' : '状態更新'}
            </button>
          </div>

          {notice && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                notice.type === 'success'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              {notice.message}
            </div>
          )}
        </header>

        {tab === 'transactions' && (
          <section className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">OCR取込</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        window.location.href = '/api/freee/oauth/start'
                      }}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white"
                    >
                    freee連携
                    </button>
                    <button
                      onClick={() => {
                        window.location.href = '/api/freee/disconnect'
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                    >
                    連携解除
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  証憑は処理のためだけに使用し、サーバーには永続保存しません（非保持優先）。
                </p>
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
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900">手入力取込</h2>
                <p className="mt-1 text-sm text-slate-600">紙導入でも使える最小入力です。保存先はfreee下書きです。</p>

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

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">連携状態</h3>
                <div className="mt-2 space-y-2 text-sm">
                  <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                    <span>freee</span>
                    <span className={status?.freee.connected ? 'font-bold text-emerald-700' : 'font-bold text-red-700'}>
                      {status?.freee.connected ? '接続済み' : '未接続'}
                    </span>
                  </div>
                  <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                    <span>OCR</span>
                    <span className={status?.ocr.enabled ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>
                      {status?.ocr.enabled ? '有効' : '無効'}
                    </span>
                  </div>
                  <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                    <span>モデル</span>
                    <span className="font-semibold text-slate-700">{status?.llm.model ?? '-'}</span>
                  </div>
                  <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                    <span>接続方式</span>
                    <span className="font-semibold text-slate-700">
                      {status?.freee.mode === 'shared_token' ? '共通トークン' : 'ユーザーOAuth'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">注意</h3>
                <p className="mt-2 text-xs text-slate-600">
                  税務判断の最終責任は専門家にあります。サービスは判定補助と下書き作成を提供します。
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  問い合わせ境界: 接続/判定パイプラインは当方、会計仕様/仕訳仕様はfreeeサポート。
                </p>
              </div>
            </aside>
          </section>
        )}

        {tab === 'queue' && (
          <section className="mt-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">判定キュー</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => void refreshFreeeQueue()}
                    disabled={isLoadingQueue}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:bg-slate-100"
                  >
                    {isLoadingQueue ? '取得中...' : 'freee下書きを取得'}
                  </button>
                  <button
                    onClick={postDrafts}
                    disabled={isPostingDraft || postableCommands.length === 0}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-400"
                  >
                    {isPostingDraft ? '送信中...' : `OKをfreee下書き送信 (${postableCommands.length})`}
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
                          {record.transaction.occurred_at} / {formatYen(record.transaction.amount)} / {record.transaction.memo_redacted}
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
                            ? `freee送信済み (deal: ${record.posted.freee_deal_id ?? '-'})`
                            : `送信失敗 (${record.posted.diagnostic_code})`}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">freeeレビューキュー</h3>
              <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="p-2 text-left">ID</th>
                      <th className="p-2 text-left">日付</th>
                      <th className="p-2 text-right">金額</th>
                      <th className="p-2 text-left">状態</th>
                      <th className="p-2 text-left">メモ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {freeeQueue.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-3 text-center text-slate-500">
                          freeeレビューキューがありません。
                        </td>
                      </tr>
                    ) : (
                      freeeQueue.map((row, index) => (
                        <tr key={`${row.id ?? 'n'}-${index}`} className="border-t border-slate-100">
                          <td className="p-2">{row.id ?? '-'}</td>
                          <td className="p-2">{row.issue_date || '-'}</td>
                          <td className="p-2 text-right">{formatYen(row.amount)}</td>
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
