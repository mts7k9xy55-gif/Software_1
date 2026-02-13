import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { toDeterministicUuid } from '@/lib/supabaseHelpers'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase service role env missing')
  return createClient(url, key)
}

function sanitizeDateInput(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const expenseDateRaw = String(formData.get('expenseDate') ?? '')
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'file is required' }, { status: 400 })
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ ok: false, error: 'only image file is allowed' }, { status: 400 })
    }

    const expenseDate = sanitizeDateInput(expenseDateRaw)
    const shopId = toDeterministicUuid(userId)
    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
    const filePath = `${shopId}/${expenseDate}/${Date.now()}.${extension}`

    const supabase = getAdminClient()
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error } = await supabase.storage.from('expense-receipts').upload(filePath, buffer, {
      contentType: file.type,
      upsert: false,
    })

    if (error) {
      return NextResponse.json({ ok: false, error: `upload failed: ${error.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, filePath })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `upload failed: ${error instanceof Error ? error.message : 'unknown'}` },
      { status: 500 }
    )
  }
}
