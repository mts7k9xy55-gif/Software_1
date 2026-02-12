import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  const cookieStore = cookies()

  const configured = Boolean(
    process.env.NEXT_PUBLIC_FREEE_CLIENT_ID &&
    process.env.FREEE_CLIENT_SECRET &&
    process.env.NEXT_PUBLIC_FREEE_REDIRECT_URI
  )

  const accessToken = cookieStore.get('freee_access_token')?.value ?? ''
  const refreshToken = cookieStore.get('freee_refresh_token')?.value ?? ''
  const companyIdRaw = cookieStore.get('freee_company_id')?.value ?? ''
  const companyId = companyIdRaw ? Number(companyIdRaw) : null

  return NextResponse.json({
    configured,
    connected: Boolean(accessToken),
    companyId: Number.isFinite(companyId) ? companyId : null,
    hasRefreshToken: Boolean(refreshToken),
    message: configured
      ? accessToken
        ? 'freee接続済みです。'
        : 'freee OAuthを開始すると接続できます。'
      : 'freee環境変数が不足しています。',
  })
}
