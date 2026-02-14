import type { AccountingProvider } from '@/lib/core/types'

export interface ProviderSupportContact {
  name: string
  url: string
}

export interface AccountingProviderDefinition {
  key: AccountingProvider
  label: string
  regionCodes: string[]
  support: ProviderSupportContact
  docsUrl: string
}

export const ACCOUNTING_PROVIDER_DEFINITIONS: AccountingProviderDefinition[] = [
  {
    key: 'freee',
    label: 'freee',
    regionCodes: ['JP', 'GLOBAL'],
    support: {
      name: 'freee Support',
      url: 'https://support.freee.co.jp/hc/ja',
    },
    docsUrl: 'https://developer.freee.co.jp/docs/accounting',
  },
  {
    key: 'quickbooks',
    label: 'QuickBooks Online',
    regionCodes: ['US', 'GLOBAL'],
    support: {
      name: 'QuickBooks Support',
      url: 'https://quickbooks.intuit.com/learn-support/',
    },
    docsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities',
  },
  {
    key: 'xero',
    label: 'Xero',
    regionCodes: ['EU', 'GLOBAL'],
    support: {
      name: 'Xero Support',
      url: 'https://central.xero.com/s/',
    },
    docsUrl: 'https://developer.xero.com/documentation/api/accounting/overview',
  },
]

const FALLBACK_PROVIDER: AccountingProvider = 'freee'

export function getProviderDefinition(provider: AccountingProvider): AccountingProviderDefinition {
  return (
    ACCOUNTING_PROVIDER_DEFINITIONS.find((row) => row.key === provider) ??
    ACCOUNTING_PROVIDER_DEFINITIONS[0]
  )
}

export function resolveProviderByRegion(regionCode?: string | null): AccountingProvider {
  const normalized = String(regionCode ?? '').trim().toUpperCase()
  const matched = ACCOUNTING_PROVIDER_DEFINITIONS.find((row) => row.regionCodes.includes(normalized))
  return matched?.key ?? FALLBACK_PROVIDER
}

export function listProvidersByRegion(regionCode?: string | null): AccountingProviderDefinition[] {
  const normalized = String(regionCode ?? '').trim().toUpperCase()
  const byRegion = ACCOUNTING_PROVIDER_DEFINITIONS.filter((row) => row.regionCodes.includes(normalized))
  if (byRegion.length > 0) return byRegion
  return ACCOUNTING_PROVIDER_DEFINITIONS
}
