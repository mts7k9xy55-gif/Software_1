export type Locale = 'ja' | 'en'

const LOCALE_STORAGE_KEY = 'taxman:locale'

export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'ja'
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  return stored === 'en' ? 'en' : 'ja'
}

export function setStoredLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
}

export function formatMoney(value: number, currency: string, locale?: Locale): string {
  const loc = locale ?? (typeof window !== 'undefined' ? getStoredLocale() : 'ja')
  const localeStr = loc === 'ja' ? 'ja-JP' : 'en-US'
  return new Intl.NumberFormat(localeStr, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatDate(dateStr: string, locale?: Locale): string {
  const loc = locale ?? (typeof window !== 'undefined' ? getStoredLocale() : 'ja')
  const localeStr = loc === 'ja' ? 'ja-JP' : 'en-US'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return new Intl.DateTimeFormat(localeStr, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}
