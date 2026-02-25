/**
 * Stripe 決済取引の取得・正規化
 * STRIPE_SECRET_KEY が必要
 */

export interface StripeCharge {
  id: string
  amount: number
  currency: string
  created: number
  description?: string | null
  receipt_email?: string | null
  metadata?: Record<string, string>
}

export interface StripeTransactionInput {
  id: string
  date: string
  amount: number
  description: string
  direction: 'income' | 'expense'
  counterparty?: string
  currency?: string
}

export async function fetchStripeCharges(limit = 100): Promise<StripeTransactionInput[]> {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required')

  const response = await fetch(
    `https://api.stripe.com/v1/charges?limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    throw new Error(`Stripe API error: ${response.status}`)
  }

  const data = (await response.json()) as { data?: StripeCharge[] }
  const charges = data.data ?? []

  return charges.map((c) => {
    const date = new Date(c.created * 1000).toISOString().slice(0, 10)
    const amount = c.amount / 100 // Stripe uses cents
    const description = (c.description ?? `Stripe charge ${c.id}`).slice(0, 200)
    return {
      id: c.id,
      date,
      amount,
      description,
      direction: 'income' as const,
      counterparty: c.receipt_email ?? undefined,
      currency: c.currency,
    }
  })
}
