export type RegionCode = 'JP' | 'US' | 'EU' | 'TH'

export type PlatformStatus = 'ready' | 'planned'

export interface RegionPlatform {
  key: string
  name: string
  category: 'accounting' | 'payments' | 'pos' | 'payroll'
  status: PlatformStatus
}

export interface RegionDefinition {
  code: RegionCode
  name: string
  description: string
  currency: string
  countryCode: string
  uxLabel: string
  accentFrom: string
  accentTo: string
  platforms: RegionPlatform[]
}

export const REGIONS: RegionDefinition[] = [
  {
    code: 'JP',
    name: 'Japan',
    description: 'freee中心で申告下書きを自動化する運用。',
    currency: 'JPY',
    countryCode: 'JP',
    uxLabel: 'JP Filing UX',
    accentFrom: '#0f766e',
    accentTo: '#0f172a',
    platforms: [
      { key: 'freee', name: 'freee', category: 'accounting', status: 'ready' },
      { key: 'airregi', name: 'AirREGI', category: 'pos', status: 'planned' },
      { key: 'stripe', name: 'Stripe', category: 'payments', status: 'planned' },
    ],
  },
  {
    code: 'US',
    name: 'United States',
    description: 'QBO/Xeroへつなぐ多国型テンプレート。',
    currency: 'USD',
    countryCode: 'US',
    uxLabel: 'US Filing UX',
    accentFrom: '#1d4ed8',
    accentTo: '#111827',
    platforms: [
      { key: 'quickbooks', name: 'QuickBooks Online', category: 'accounting', status: 'planned' },
      { key: 'stripe', name: 'Stripe', category: 'payments', status: 'planned' },
      { key: 'square', name: 'Square', category: 'pos', status: 'planned' },
    ],
  },
  {
    code: 'EU',
    name: 'Europe',
    description: 'VAT対応のXero中心ワークフロー。',
    currency: 'EUR',
    countryCode: 'EU',
    uxLabel: 'EU Filing UX',
    accentFrom: '#7c3aed',
    accentTo: '#111827',
    platforms: [
      { key: 'xero', name: 'Xero', category: 'accounting', status: 'planned' },
      { key: 'stripe', name: 'Stripe', category: 'payments', status: 'planned' },
    ],
  },
  {
    code: 'TH',
    name: 'Thailand',
    description: '紙導入から始める東南アジア展開向け。',
    currency: 'THB',
    countryCode: 'TH',
    uxLabel: 'TH Filing UX',
    accentFrom: '#ea580c',
    accentTo: '#111827',
    platforms: [
      { key: 'xero', name: 'Xero', category: 'accounting', status: 'planned' },
      { key: 'stripe', name: 'Stripe', category: 'payments', status: 'planned' },
    ],
  },
]

export const DEFAULT_REGION_CODE: RegionCode = 'JP'

export function isRegionCode(value: string): value is RegionCode {
  return REGIONS.some((region) => region.code === value)
}

export function getRegionDefinition(code?: string | null): RegionDefinition {
  const normalized = String(code ?? '').trim().toUpperCase()
  return REGIONS.find((region) => region.code === normalized) ?? REGIONS[0]
}
