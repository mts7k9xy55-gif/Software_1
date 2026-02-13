import type {
  AccountingProvider,
  CanonicalTransaction,
  PostingCommand,
  ProviderDraftResult,
  ReviewQueueItem,
  TenantContext,
} from './types'

export interface SourceConnector {
  key: string
  title: string
  countryCodes: string[]
  pullTransactions: (args: { since?: string; until?: string }) => Promise<CanonicalTransaction[]>
}

export interface SinkConnector {
  key: string
  title: string
  countryCodes: string[]
  postDrafts: (args: {
    commands: PostingCommand[]
    tenant: TenantContext
  }) => Promise<ProviderDraftResult[]>
  fetchReviewQueue: (args: { tenant: TenantContext; limit?: number }) => Promise<ReviewQueueItem[]>
}

export interface ConnectorRouter {
  resolveProvider: (regionCode: string, requestedProvider?: AccountingProvider) => AccountingProvider
}
