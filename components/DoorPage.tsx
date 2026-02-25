'use client'

import type { RegionCode } from '@/lib/core/regions'
import { REGIONS } from '@/lib/core/regions'
import { useI18n } from '@/lib/I18nContext'
import type { Locale } from '@/lib/i18n'

type DoorPageProps = {
  selectedRegion: RegionCode
  onSelectRegion: (region: RegionCode) => void
  onEnter: () => void
}

const DOOR_MESSAGES: Record<Locale, Record<string, string>> = {
  ja: {
    title: 'あなたの地域を選択',
    desc: '地域を選ぶと、その地域の会計・税務に最適化された画面に入ります。',
    enter: '始める',
    hint: 'TaxBuddyは記録・分類・送信を自動化します。最終確定は各国の会計ソフトで行います。',
  },
  en: {
    title: 'Select your region',
    desc: 'Choose your region to enter an experience optimized for local accounting and tax filing.',
    enter: 'Get started',
    hint: 'TaxBuddy automates recording, classification, and submission. Final filing is handled by your local accounting software.',
  },
}

export default function DoorPage({ selectedRegion, onSelectRegion, onEnter }: DoorPageProps) {
  const { locale, setLocale } = useI18n()
  const msg = DOOR_MESSAGES[locale]
  return (
    <div className="min-h-screen bg-[#fafafa] p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-lg border border-zinc-200 bg-white p-8 md:p-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">TaxBuddy</p>
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
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight text-[#1a1a1a] md:text-3xl">
                {msg.title}
              </h1>
              <p className="mt-3 text-sm text-zinc-500">{msg.desc}</p>
            </div>
            <button
              onClick={onEnter}
              className="rounded-lg bg-slate-800 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-700"
            >
              {msg.enter}
            </button>
          </div>

          <div className="mt-8 divide-y divide-slate-200">
            {REGIONS.map((region) => {
              const selected = region.code === selectedRegion
              return (
                <button
                  key={region.code}
                  onClick={() => onSelectRegion(region.code)}
                  className={`flex w-full items-center justify-between gap-4 py-4 text-left transition first:pt-0 ${
                    selected ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <div className="flex flex-col items-start gap-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold">{region.name}</h2>
                      <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {region.code}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">{region.description}</p>
                    <div className="flex flex-wrap gap-2">
                      {region.platforms.map((platform) => (
                        <span key={platform.key} className="text-[11px] font-medium text-slate-500">
                          {platform.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${selected ? 'bg-buddy-green' : 'bg-slate-300'}`} />
                </button>
              )
            })}
          </div>

          <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
            {msg.hint}
          </div>
        </div>
      </div>
    </div>
  )
}
