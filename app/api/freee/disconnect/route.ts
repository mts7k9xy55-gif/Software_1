import { NextRequest, NextResponse } from 'next/server'

function getOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host) return `${proto}://${host}`
  return new URL(request.url).origin
}

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/?freee=disconnected', getOrigin(request)))
  response.cookies.delete('freee_oauth_state')
  response.cookies.delete('freee_access_token')
  response.cookies.delete('freee_refresh_token')
  response.cookies.delete('freee_company_id')
  return response
}

