import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { toDeterministicUuid } from '@/lib/supabaseHelpers'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase service role env missing')
  return createClient(url, key)
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as { path?: string }
    const path = String(body.path ?? '').trim()
    if (!path) {
      return NextResponse.json({ ok: false, error: 'path is required' }, { status: 400 })
    }

    const shopId = toDeterministicUuid(userId)
    if (!path.startsWith(`${shopId}/`)) {
      return NextResponse.json({ ok: false, error: 'forbidden path' }, { status: 403 })
    }

    const supabase = getAdminClient()
    const { data, error } = await supabase.storage.from('expense-receipts').createSignedUrl(path, 60 * 5)

    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { ok: false, error: `signed url failed: ${error?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, signedUrl: data.signedUrl })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `signed url failed: ${error instanceof Error ? error.message : 'unknown'}` },
      { status: 500 }
    )
  }
}
