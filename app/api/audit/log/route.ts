import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { toDeterministicUuid } from '@/lib/supabaseHelpers'

interface AuditPayload {
  eventType?: string
  resourceType?: string
  resourceId?: string
  metadata?: Record<string, unknown>
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase service role env missing')
  return createClient(url, key)
}

function sanitizeText(value: unknown, max = 120): string {
  return String(value ?? '').trim().slice(0, max)
}

function sanitizeMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const entries = Object.entries(metadata as Record<string, unknown>).slice(0, 20)
  const safe: Record<string, unknown> = {}
  for (const [k, v] of entries) {
    const key = sanitizeText(k, 40)
    if (!key) continue
    if (typeof v === 'string') safe[key] = sanitizeText(v, 200)
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) safe[key] = v
    else safe[key] = '[object]'
  }
  return safe
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as AuditPayload
    const eventType = sanitizeText(body.eventType, 60)
    const resourceType = sanitizeText(body.resourceType, 60)
    const resourceId = sanitizeText(body.resourceId, 120)

    if (!eventType || !resourceType) {
      return NextResponse.json({ ok: false, error: 'eventType/resourceType required' }, { status: 400 })
    }

    const shopId = toDeterministicUuid(userId)
    const supabase = getAdminClient()
    const { error } = await supabase.from('audit_logs').insert({
      shop_id: shopId,
      actor_clerk_id: userId,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: resourceId || null,
      metadata: sanitizeMetadata(body.metadata),
    })

    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return NextResponse.json({ ok: true, skipped: true, reason: 'audit_logs table missing' })
      }
      return NextResponse.json({ ok: false, error: `audit insert failed: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `audit log failed: ${error instanceof Error ? error.message : 'unknown'}` },
      { status: 500 }
    )
  }
}
