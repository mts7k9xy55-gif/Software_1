'use client'

import { createContext, useContext, useCallback, useState, useEffect } from 'react'
import type { Locale } from './i18n'
import { getStoredLocale, setStoredLocale } from './i18n'

import ja from '@/messages/ja.json'
import en from '@/messages/en.json'

const messages: Record<Locale, Record<string, Record<string, string>>> = {
  ja: ja as Record<string, Record<string, string>>,
  en: en as Record<string, Record<string, string>>,
}

type I18nContextValue = {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (ns: string, key: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ja')

  useEffect(() => {
    setLocaleState(getStoredLocale())
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setStoredLocale(l)
    setLocaleState(l)
  }, [])

  const t = useCallback(
    (ns: string, key: string) => {
      const nsData = messages[locale]?.[ns]
      return nsData?.[key] ?? key
    },
    [locale]
  )

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  return ctx ?? { locale: 'ja' as Locale, setLocale: () => {}, t: (_ns: string, key: string) => key }
}
