import { NextResponse } from 'next/server'

const FREEE_AUTH_BASE_URL = 'https://accounts.secure.freee.co.jp/public_api/authorize'

export async function GET() {
  const clientId = process.env.NEXT_PUBLIC_FREEE_CLIENT_ID
  const redirectUri = process.env.NEXT_PUBLIC_FREEE_REDIRECT_URI

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error: 'missing_env',
        message: 'NEXT_PUBLIC_FREEE_CLIENT_ID / NEXT_PUBLIC_FREEE_REDIRECT_URI を設定してください。',
      },
      { status: 500 }
    )
  }

  const state = crypto.randomUUID()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    // freeeの公式スタートガイドで推奨される事業所選択フロー
    prompt: 'select_company',
  })

  const response = NextResponse.redirect(`${FREEE_AUTH_BASE_URL}?${params.toString()}`)
  response.cookies.set('freee_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
  })

  return response
}
