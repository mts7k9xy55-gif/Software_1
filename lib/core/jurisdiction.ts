export interface JurisdictionProfile {
  countryCode: string
  currency: string
  ruleVersion: string
  promptHint: string
  deductibleThresholdYen: number
  reviewConfidenceThreshold: number
  maxAllocationRate: number
}

const JP_PROFILE: JurisdictionProfile = {
  countryCode: 'JP',
  currency: 'JPY',
  ruleVersion: 'jp-2026-02-no2210-v1',
  promptHint: '国税庁 No.2210 の必要経費基準を優先し、根拠不足は要確認に回す。',
  deductibleThresholdYen: 150000,
  reviewConfidenceThreshold: 0.75,
  maxAllocationRate: 1,
}

const DEFAULT_PROFILE: JurisdictionProfile = {
  countryCode: 'GLOBAL',
  currency: 'USD',
  ruleVersion: 'global-v1',
  promptHint: 'Conservative tax classification. Route uncertain records to REVIEW.',
  deductibleThresholdYen: 1000,
  reviewConfidenceThreshold: 0.75,
  maxAllocationRate: 1,
}

const PROFILES: Record<string, JurisdictionProfile> = {
  JP: JP_PROFILE,
  GLOBAL: DEFAULT_PROFILE,
}

export function getJurisdictionProfile(countryCode?: string | null): JurisdictionProfile {
  const key = String(countryCode ?? '').trim().toUpperCase()
  return PROFILES[key] ?? { ...DEFAULT_PROFILE, countryCode: key || 'GLOBAL' }
}
