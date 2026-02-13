export type PackKey =
  | 'core_filing'
  | 'shift_touch'
  | 'inventory_ops'
  | 'marketplace_connector'
  | 'pos_connector_jp'

export interface PackDefinition {
  key: PackKey
  title: string
  enabledByDefault: boolean
  description: string
}

export const PACKS: PackDefinition[] = [
  {
    key: 'core_filing',
    title: 'Core Filing',
    enabledByDefault: true,
    description: 'Intake + Decision Queue + provider draft posting.',
  },
  {
    key: 'shift_touch',
    title: 'Shift Touch Pack',
    enabledByDefault: false,
    description: 'Touch-based attendance and labor cost feed.',
  },
  {
    key: 'inventory_ops',
    title: 'Inventory Pack',
    enabledByDefault: false,
    description: 'Stock movement and cost-of-goods connector.',
  },
  {
    key: 'marketplace_connector',
    title: 'Marketplace Pack',
    enabledByDefault: false,
    description: 'Amazon and marketplace transaction connector.',
  },
  {
    key: 'pos_connector_jp',
    title: 'POS Pack (JP)',
    enabledByDefault: false,
    description: 'JP POS adapter (AirREGI plugin).',
  },
]

export function getEnabledPacks(overrides?: Partial<Record<PackKey, boolean>>): PackDefinition[] {
  return PACKS.filter((pack) => {
    if (overrides && typeof overrides[pack.key] === 'boolean') return Boolean(overrides[pack.key])
    return pack.enabledByDefault
  })
}
