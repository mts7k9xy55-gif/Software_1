export type SupabaseLikeError = {
  code?: string
  message?: string
}

export function isInvalidUuidError(error: SupabaseLikeError | null): boolean {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === '22P02' || message.includes('invalid input syntax for type uuid')
}

export function toDeterministicUuid(seed: string): string {
  const value = seed.trim().toLowerCase()
  if (!value) {
    return '00000000-0000-4000-8000-000000000000'
  }

  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179)
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)

  const hex = [h1, h2, h3, h4]
    .map((n) => (n >>> 0).toString(16).padStart(8, '0'))
    .join('')
    .slice(0, 32)
    .split('')

  hex[12] = '4'
  const variant = parseInt(hex[16], 16)
  hex[16] = ((variant & 0x3) | 0x8).toString(16)

  const normalized = hex.join('')
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(
    12,
    16
  )}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`
}
