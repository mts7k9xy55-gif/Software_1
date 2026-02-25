import { NextResponse } from 'next/server'

/**
 * Vercel Cron: 信頼度閾値以上の未送信取引を自動送信
 * CRON_SECRET で保護。FREEE_SHARED_MODE=1 等の shared token が設定されている場合のみ実行。
 * vercel.json で cron スケジュールを設定してください。
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }

  // Shared mode が未設定の場合はスキップ（将来的に shared org を DB から取得して実行）
  const hasSharedFreee =
    process.env.FREEE_SHARED_MODE === '1' &&
    process.env.FREEE_SHARED_ACCESS_TOKEN &&
    process.env.FREEE_SHARED_COMPANY_ID

  if (!hasSharedFreee) {
    return NextResponse.json({ ok: true, message: 'No shared org configured, skipped' })
  }

  // TODO: shared org 向けの auto-post 実行
  // 現状はユーザーセッションが必要なため、ボタン経由の /api/auto-post/run を使用
  return NextResponse.json({ ok: true, message: 'Cron placeholder; use /api/auto-post/run with auth' })
}
