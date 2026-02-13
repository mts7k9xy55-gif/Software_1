'use client'

import type { RegionCode } from '@/lib/core/regions'
import { REGIONS } from '@/lib/core/regions'

type DoorPageProps = {
  selectedRegion: RegionCode
  onSelectRegion: (region: RegionCode) => void
  onEnter: () => void
}

export default function DoorPage({ selectedRegion, onSelectRegion, onEnter }: DoorPageProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_20%,#fef3c7_0%,#f8fafc_35%,#dbeafe_100%)] p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-xl backdrop-blur md:p-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Tax man</p>
              <h1 className="mt-1 text-3xl font-black leading-tight text-slate-900 md:text-5xl">
                Region Door
              </h1>
              <p className="mt-3 text-sm text-slate-600 md:text-base">
                地域を選ぶだけで、その地域向けの申告自動化UXに入ります。
              </p>
            </div>
            <button
              onClick={onEnter}
              className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-700"
            >
              この地域で入る
            </button>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {REGIONS.map((region) => {
              const selected = region.code === selectedRegion
              return (
                <button
                  key={region.code}
                  onClick={() => onSelectRegion(region.code)}
                  className={`rounded-2xl border p-5 text-left transition ${
                    selected
                      ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                      : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xl font-black">{region.name}</h2>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                        selected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {region.code}
                    </span>
                  </div>
                  <p className={`mt-2 text-sm ${selected ? 'text-white/90' : 'text-slate-600'}`}>{region.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {region.platforms.map((platform) => (
                      <span
                        key={platform.key}
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {platform.name}
                      </span>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            ドアページは入口だけに集中。実務画面は次ページで「取引取込 / 判定キュー」の2面だけです。
          </div>
        </div>
      </div>
    </div>
  )
}
