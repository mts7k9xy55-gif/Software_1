'use client'

import { useEffect, useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import type { RegionDefinition } from '@/lib/core/regions'
import { useI18n } from '@/lib/I18nContext'
import { formatMoney } from '@/lib/i18n'
import FilingOrchestratorApp from '@/components/FilingOrchestratorApp'

type ExecutiveDashboardProps = {
  region: RegionDefinition
  onSwitchRegion: () => void
}

type ConnectorStatus = {
  provider: string
  label: string
  connected: boolean
  configured: boolean
}

type PlatformInfo = {
  key: string
  name: string
  category: 'accounting' | 'payments' | 'pos' | 'payroll'
  status: 'ready' | 'planned'
}

type DashboardData = {
  totalRevenue: number
  totalExpense: number
  transactionCount: number
  reviewCount: number
  postedCount: number
  classifiedCount: number
  connectors: ConnectorStatus[]
  platforms: PlatformInfo[]
}

export default function ExecutiveDashboard({ region, onSwitchRegion }: ExecutiveDashboardProps) {
  const { signOut } = useClerk()
  const { locale, setLocale, t } = useI18n()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'dashboard' | 'transactions'>('dashboard')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [statusRes, listRes] = await Promise.all([
          fetch(`/api/connectors/status?region=${region.code}`, { cache: 'no-store' }),
          fetch(`/api/transactions/list?region=${region.code}&limit=500`, { cache: 'no-store' }),
        ])

        const statusJson = (await statusRes.json()) as {
          ok?: boolean
          status?: {
            providers?: Array<{ provider: string; label: string; connected: boolean; configured?: boolean }>
            region?: { platforms?: Array<{ key: string; name: string; category: string; status: string }> }
          }
        }
        const listJson = (await listRes.json()) as {
          ok?: boolean
          records?: Array<{
            transaction: { amount: number; direction: string }
            decision: { rank: string }
            posted?: unknown
          }>
        }

        const records = listJson.ok && Array.isArray(listJson.records) ? listJson.records : []
        const revenue = records
          .filter((r) => r.transaction.direction === 'income')
          .reduce((sum, r) => sum + r.transaction.amount, 0)
        const expense = records
          .filter((r) => r.transaction.direction === 'expense')
          .reduce((sum, r) => sum + r.transaction.amount, 0)
        const reviewCount = records.filter((r) => r.decision.rank === 'REVIEW').length
        const postedCount = records.filter((r) => r.posted != null).length
        const classifiedCount = records.filter(
          (r) => r.decision.rank === 'OK' || r.decision.rank === 'NG'
        ).length

        const connectors: ConnectorStatus[] =
          statusJson.ok && Array.isArray(statusJson.status?.providers)
            ? statusJson.status.providers.map((p) => ({
                provider: p.provider,
                label: p.label,
                connected: p.connected,
                configured: p.configured ?? false,
              }))
            : []

        const platforms: PlatformInfo[] =
          statusJson.ok && Array.isArray(statusJson.status?.region?.platforms)
            ? statusJson.status.region.platforms.map((p) => ({
                key: p.key,
                name: p.name,
                category: p.category as PlatformInfo['category'],
                status: (p.status === 'ready' ? 'ready' : 'planned') as 'ready' | 'planned',
              }))
            : region.platforms.map((p) => ({
                key: p.key,
                name: p.name,
                category: p.category,
                status: p.status,
              }))

        setData({
          totalRevenue: revenue,
          totalExpense: expense,
          transactionCount: records.length,
          reviewCount,
          postedCount,
          classifiedCount,
          connectors,
          platforms,
        })
      } catch {
        setData({
          totalRevenue: 0,
          totalExpense: 0,
          transactionCount: 0,
          reviewCount: 0,
          postedCount: 0,
          classifiedCount: 0,
          connectors: [],
          platforms: region.platforms.map((p) => ({
            key: p.key,
            name: p.name,
            category: p.category,
            status: p.status,
          })),
        })
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [region.code, region.platforms])

  if (view === 'transactions') {
    return (
      <FilingOrchestratorApp
        region={region}
        onSwitchRegion={() => {
          setView('dashboard')
          onSwitchRegion()
        }}
      />
    )
  }

  const profit = (data?.totalRevenue ?? 0) - (data?.totalExpense ?? 0)
  const reviewCount = data?.reviewCount ?? 0

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-12">
          <p className="text-xl font-bold text-[#1a1a1a]">TaxBuddy</p>
          <div className="flex items-center gap-4">
            <span className="text-[13px] font-medium text-zinc-500">
              {region.code} / {region.currency}
            </span>
            <button
              onClick={onSwitchRegion}
              className="text-[13px] font-medium text-zinc-500 hover:text-zinc-900"
            >
              {t('common', 'regionChange')}
            </button>
            <button
              onClick={() => void signOut()}
              className="text-[13px] font-medium text-zinc-500 hover:text-zinc-900"
            >
              {t('common', 'logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-12 py-10">
        {loading ? (
          <div className="flex min-h-[400px] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-transparent" />
          </div>
        ) : (
          <>
            <hr className="border-zinc-200" />

            <div className="flex flex-wrap items-start gap-16 py-8">
              <div className="space-y-1">
                <p className="section-title">売上</p>
                <p className="kpi-value text-[#1a1a1a]">
                  {formatMoney(data?.totalRevenue ?? 0, region.currency, locale)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="section-title">経費</p>
                <p className="kpi-value text-[#1a1a1a]">
                  {formatMoney(data?.totalExpense ?? 0, region.currency, locale)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="section-title">粗利</p>
                <p className="kpi-value text-[#1a1a1a]">
                  {formatMoney(profit, region.currency, locale)}
                </p>
              </div>
              <p className="self-center text-[13px] text-zinc-500">
                Buddy: {profit >= 0 ? '今月は通常範囲です。' : '経費を確認してみましょう。'}
              </p>
            </div>

            <hr className="border-zinc-200" />

            <div className="flex flex-wrap items-center gap-8 py-6 text-sm">
              <span className="tabular-nums font-medium text-[#1a1a1a]">
                取込&nbsp;&nbsp;<strong>{data?.transactionCount ?? 0}</strong>件
              </span>
              <span className="tabular-nums font-medium text-[#1a1a1a]">
                分類済&nbsp;&nbsp;<strong>{data?.classifiedCount ?? 0}</strong>件
              </span>
              <span className="tabular-nums font-medium text-[#1a1a1a]">
                送信済&nbsp;&nbsp;<strong>{data?.postedCount ?? 0}</strong>件
              </span>
              {reviewCount > 0 ? (
                <button
                  onClick={() => setView('transactions')}
                  className="tabular-nums font-semibold text-buddy-green hover:underline"
                >
                  要確認&nbsp;&nbsp;<strong>{reviewCount}</strong>件 →
                </button>
              ) : (
                <span className="tabular-nums font-medium text-[#1a1a1a]">
                  要確認&nbsp;&nbsp;<strong>{reviewCount}</strong>件
                </span>
              )}
            </div>

            <hr className="border-zinc-200" />

            {reviewCount > 0 && (
              <div className="flex flex-wrap items-center gap-4 py-6">
                <p className="text-sm text-zinc-500">
                  Buddy: 未分類が{reviewCount}件あります。確認しますか？
                </p>
                <button
                  onClick={() => setView('transactions')}
                  className="rounded-lg bg-buddy-green px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90"
                >
                  確認する
                </button>
              </div>
            )}

            <hr className="border-zinc-200" />

            <div className="py-6">
              <p className="section-title mb-4">送信先</p>
              {(data?.platforms ?? region.platforms).map((platform) => {
                const conn = data?.connectors?.find((c) => c.provider === platform.key)
                const connected = conn?.connected ?? false
                const isAccounting = platform.category === 'accounting'
                const canConnect = isAccounting && platform.status === 'ready'

                return (
                  <div
                    key={platform.key}
                    className="flex items-center justify-between border-b border-zinc-100 py-3 last:border-0"
                  >
                    <span className="text-sm font-medium text-[#1a1a1a]">{platform.name}</span>
                    <span className="flex items-center gap-2 text-[13px] text-zinc-500">
                      {connected ? (
                        <>
                          <span className="h-2 w-2 rounded-full bg-buddy-green" />
                          接続済み
                        </>
                      ) : canConnect ? (
                        <a
                          href={`/api/connectors/oauth/start?provider=${platform.key}&region=${region.code}&return_to=/`}
                          className="rounded-lg bg-[#1e293b] px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700"
                        >
                          接続する
                        </a>
                      ) : (
                        '準備中'
                      )}
                    </span>
                  </div>
                )
              })}
            </div>

            <hr className="border-zinc-200" />

            <div className="flex flex-wrap gap-3 py-6">
              <button
                onClick={() => setView('transactions')}
                className="rounded-lg bg-[#1e293b] px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700"
              >
                取引を記録する
              </button>
              <button
                onClick={() => setView('transactions')}
                className="rounded-lg border border-zinc-200 bg-white px-6 py-3 text-sm font-semibold text-[#1a1a1a] transition hover:bg-zinc-50"
              >
                CSVを出力する
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
