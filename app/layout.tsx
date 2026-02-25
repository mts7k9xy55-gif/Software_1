import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter, Noto_Sans_JP } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import Link from 'next/link'
import PWARegister from '@/components/PWARegister'
import { I18nProvider } from '@/lib/I18nContext'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const notoSansJP = Noto_Sans_JP({ subsets: ['latin'], variable: '--font-noto' })

export const metadata: Metadata = {
  title: 'TaxBuddy',
  description: 'TaxBuddy - Tax filing automation with AI',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'TaxBuddy',
  },
}

export const viewport: Viewport = {
  themeColor: '#22c55e',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable}`}>
      <body className="font-sans antialiased">
        <ClerkProvider>
          <I18nProvider>
          <PWARegister />
          <div className="min-h-screen">
            {children}
            <footer className="border-t border-slate-200 bg-white px-4 py-4 text-xs text-slate-600">
              <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3">
                <span>© TaxBuddy</span>
                <Link href="/legal/privacy" className="font-semibold text-slate-700 hover:underline">
                  Privacy Policy
                </Link>
                <Link href="/legal/terms" className="font-semibold text-slate-700 hover:underline">
                  Terms and Conditions
                </Link>
              </div>
            </footer>
          </div>
          </I18nProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
