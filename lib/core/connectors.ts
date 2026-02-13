import type { CanonicalTransaction, PostingCommand, PostingResult } from './types'

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
  postDrafts: (commands: PostingCommand[]) => Promise<PostingResult[]>
}
