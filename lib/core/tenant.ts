import type { OperationMode, TenantContext } from './types'

export function normalizeMode(input?: string | null): OperationMode {
  const value = String(input ?? '').trim().toLowerCase()
  return value === 'direct' ? 'direct' : 'tax_pro'
}

export function resolveTenantContext(args: {
  auth: { userId: string | null; orgId?: string | null }
  regionCode?: string | null
  mode?: string | null
}): TenantContext | null {
  const userId = args.auth.userId
  if (!userId) return null

  const orgId = args.auth.orgId
  const organizationId = orgId ?? `user:${userId}`
  const regionCode = String(args.regionCode ?? 'JP').trim().toUpperCase() || 'JP'

  return {
    region_code: regionCode,
    organization_id: organizationId,
    mode: normalizeMode(args.mode),
    user_id: userId,
  }
}
