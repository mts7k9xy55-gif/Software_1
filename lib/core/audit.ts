import type { AuditMeta } from './types'

export function createAuditMeta(input: Omit<AuditMeta, 'event_id' | 'created_at'>): AuditMeta {
  return {
    ...input,
    event_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  }
}

export function emitAuditMeta(meta: AuditMeta): void {
  // Non-retention policy: emit structured logs only. Do not persist sensitive payloads.
  // eslint-disable-next-line no-console
  console.info('[audit-meta]', JSON.stringify(meta))
}
