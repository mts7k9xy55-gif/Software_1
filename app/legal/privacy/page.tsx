import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy | Tax man',
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-2xl font-black text-slate-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-slate-600">最終更新日: 2026-02-14</p>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">1. 取得する情報</h2>
          <p>
            本サービス（Tax man）は、認証情報、取引データ（日時・金額・用途）、会計連携に必要なOAuthトークン等を取得します。
            証憑画像はOCR処理のために一時利用し、コア導線では永続保存しません。
          </p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">2. 利用目的</h2>
          <p>
            取得した情報は、税務申告準備の自動化（取引の分類、レビューキュー生成、会計サービスへの下書き送信）に利用します。
          </p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">3. 外部サービス連携</h2>
          <p>
            本サービスはfreee、QuickBooks、Xero、LLM/OCR提供事業者などの外部サービスと連携します。各連携先でのデータ取扱いは、当該事業者の規約とポリシーに従います。
          </p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">4. 第三者提供</h2>
          <p>
            法令に基づく場合を除き、本人同意なく第三者へ個人情報を提供しません。ただし、サービス提供に必要な範囲で委託先・連携先へ情報を送信する場合があります。
          </p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">5. 安全管理措置</h2>
          <p>
            認証必須、最小権限、機微情報マスキング、監査メタログ管理等の措置を講じます。トークン漏えいが疑われる場合は速やかに失効・再発行してください。
          </p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">6. 開示・訂正・削除</h2>
          <p>法令に基づき、合理的な範囲で対応します。問い合わせは運営窓口までご連絡ください。</p>
        </section>

        <section className="mt-6 space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-base font-bold text-slate-900">7. 改定</h2>
          <p>本ポリシーは必要に応じて改定されます。改定後は本ページに掲載した時点で効力を生じます。</p>
        </section>

        <div className="mt-8 border-t border-slate-200 pt-4 text-sm">
          <Link href="/legal/terms" className="font-semibold text-blue-700 hover:underline">
            Terms and Conditions
          </Link>
        </div>
      </article>
    </main>
  )
}
