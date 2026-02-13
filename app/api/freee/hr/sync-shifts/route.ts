import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { freeeFetchWithAutoRefresh } from '../../_shared'

type ShiftInput = {
  shift_date: string
  staff_name: string
  start_time: string
  end_time: string
  hourly_wage: number
  break_minutes: number
}

export async function POST(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const cookieStore = cookies()
  const accessToken = cookieStore.get('freee_access_token')?.value ?? ''
  const refreshToken = cookieStore.get('freee_refresh_token')?.value ?? ''
  const companyIdRaw = cookieStore.get('freee_company_id')?.value ?? ''
  const companyId = companyIdRaw && /^\d+$/.test(companyIdRaw) ? Number(companyIdRaw) : null

  if (!accessToken) return NextResponse.json({ ok: false, error: 'not_connected' }, { status: 401 })
  if (!companyId) return NextResponse.json({ ok: false, error: 'missing_company' }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as { shifts?: ShiftInput[]; dryRun?: boolean }
  const shifts = Array.isArray(body.shifts)
    ? body.shifts
        .filter((shift) => {
          const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(String(shift.shift_date ?? ''))
          const staffOk = String(shift.staff_name ?? '').trim().length >= 1
          const startOk = /^\d{2}:\d{2}/.test(String(shift.start_time ?? ''))
          const endOk = /^\d{2}:\d{2}/.test(String(shift.end_time ?? ''))
          return dateOk && staffOk && startOk && endOk
        })
        .slice(0, 500)
    : []
  if (shifts.length === 0) {
    return NextResponse.json({ ok: false, error: 'missing_shifts' }, { status: 400 })
  }

  const endpoint = process.env.FREEE_HR_SHIFT_SYNC_URL ?? ''
  if (!endpoint) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      count: shifts.length,
      message: 'FREEE_HR_SHIFT_SYNC_URL が未設定のため、同期はdry-runで完了しました。',
    })
  }

  const payload = {
    company_id: companyId,
    shifts: shifts.map((s) => ({
      date: s.shift_date,
      employee_name: s.staff_name,
      start_time: s.start_time,
      end_time: s.end_time,
      break_minutes: Math.max(0, Math.floor(Number(s.break_minutes ?? 0))),
      hourly_wage: Math.max(0, Math.floor(Number(s.hourly_wage ?? 0))),
    })),
  }

  const { response, refreshed } = await freeeFetchWithAutoRefresh({
    url: endpoint,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    accessToken,
    refreshToken,
  })

  if (!response.ok) {
    return NextResponse.json({ ok: false, error: `freee_hr_error:${response.status}` }, { status: response.status })
  }

  const result = await response.json().catch(() => ({}))
  const res = NextResponse.json({ ok: true, count: shifts.length, result })
  if (refreshed?.access_token) {
    res.cookies.set('freee_access_token', refreshed.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: Math.max(60, Number(refreshed.expires_in || 0)),
      path: '/',
    })
    if (refreshed.refresh_token) {
      res.cookies.set('freee_refresh_token', refreshed.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 90,
        path: '/',
      })
    }
  }

  return res
}
