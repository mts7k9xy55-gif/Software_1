import Link from 'next/link'

export const metadata = {
  title: 'Terms and Conditions | Tax man',
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-2xl font-black text-slate-900">Terms and Conditions</h1>
        <p className="mt-2 text-sm text-slate-600">最終更新日: 2026-02-14</p>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">1. 適用</h2>
          <p>本規約は、Tax manの利用条件を定めるものです。利用者は本規約に同意のうえ利用するものとします。</p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">2. サービス内容</h2>
          <p>
            本サービスは税務処理の自動化を補助するツールであり、会計・税務の最終判断を代替するものではありません。
            最終的な申告責任は利用者および専門家（税理士等）にあります。
          </p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">3. アカウントと認証情報</h2>
          <p>
            利用者は認証情報およびAPIトークンを適切に管理する責任を負います。漏えいまたは不正利用の疑いがある場合、直ちに失効・再発行してください。
          </p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">4. 禁止事項</h2>
          <p>法令違反、第三者権利侵害、不正アクセス、システム運用を妨害する行為を禁止します。</p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">5. 免責</h2>
          <p>
            外部会計サービスや通信環境の障害、データ入力誤り、法改正等に起因する損害について、当方は法令上許される範囲で責任を負いません。
          </p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">6. 規約変更</h2>
          <p>本規約は必要に応じて変更されることがあります。変更後は本ページ掲載時点で効力を生じます。</p>
        </section>

        <div className="mt-8 border-t border-slate-200 pt-4 text-sm">
          <Link href="/legal/privacy" className="font-semibold text-blue-700 hover:underline">
            Privacy Policy
          </Link>
        </div>
      </article>
    </main>
  )
}
