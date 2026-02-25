'use client'

import { useState } from 'react'
import { SignIn, SignUp } from '@clerk/nextjs'

export default function LoginForm() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      <div className="w-full max-w-[480px] space-y-8 p-12">
        <div className="text-center">
          <h1 className="text-[28px] font-bold text-[#1a1a1a]">TaxBuddy</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">
            税務の相棒。<br />記録・分類・出力をAIと一緒に。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1">
          <button
            onClick={() => setMode('sign-in')}
            className={`rounded-md px-3 py-2 text-[13px] font-semibold ${
              mode === 'sign-in' ? 'bg-white text-[#1a1a1a] shadow-sm' : 'text-zinc-500'
            }`}
          >
            ログイン
          </button>
          <button
            onClick={() => setMode('sign-up')}
            className={`rounded-md px-3 py-2 text-[13px] font-medium ${
              mode === 'sign-up' ? 'bg-white text-[#1a1a1a] shadow-sm' : 'text-zinc-500'
            }`}
          >
            新規登録
          </button>
        </div>

        <div className="mt-4 flex justify-center">
          {mode === 'sign-in' ? (
            <SignIn
              routing="hash"
              afterSignInUrl="/"
              signUpUrl="/"
              appearance={{
                elements: {
                  card: 'shadow-none border-0 p-0',
                },
              }}
            />
          ) : (
            <SignUp
              routing="hash"
              afterSignUpUrl="/"
              signInUrl="/"
              appearance={{
                elements: {
                  card: 'shadow-none border-0 p-0',
                },
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
