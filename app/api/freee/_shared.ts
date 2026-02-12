export const FREEE_TOKEN_URL = 'https://accounts.secure.freee.co.jp/public_api/token'

export type FreeeTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
}

export async function refreshFreeeAccessToken(refreshToken: string): Promise<FreeeTokenResponse | null> {
  const clientId = process.env.NEXT_PUBLIC_FREEE_CLIENT_ID
  const clientSecret = process.env.FREEE_CLIENT_SECRET

  if (!clientId || !clientSecret) return null

  const tokenParams = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  })

  const response = await fetch(FREEE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
    cache: 'no-store',
  })

  if (!response.ok) return null
  return (await response.json()) as FreeeTokenResponse
}

export async function freeeFetchWithAutoRefresh(args: {
  url: string
  init?: RequestInit
  accessToken: string
  refreshToken: string
}): Promise<{ response: Response; refreshed: FreeeTokenResponse | null }> {
  const doFetch = async (token: string) =>
    fetch(args.url, {
      ...args.init,
      headers: {
        ...(args.init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    })

  let response = await doFetch(args.accessToken)
  let refreshed: FreeeTokenResponse | null = null

  if (response.status === 401 && args.refreshToken) {
    refreshed = await refreshFreeeAccessToken(args.refreshToken)
    if (refreshed?.access_token) {
      response = await doFetch(refreshed.access_token)
    }
  }

  return { response, refreshed }
}

