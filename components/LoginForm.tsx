'use client'

import { useState } from 'react'
import { SignIn, SignUp } from '@clerk/nextjs'

export default function LoginForm() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lg md:p-8">
        <h1 className="text-center text-2xl font-bold text-slate-900">売上記録システム</h1>
        <p className="mt-1 text-center text-base text-slate-600">Clerkで認証してPOSを利用します</p>

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
          <button
            onClick={() => setMode('sign-in')}
            className={`rounded-md px-3 py-2 text-sm font-bold ${
              mode === 'sign-in' ? 'bg-white text-slate-900 shadow' : 'text-slate-600'
            }`}
          >
            ログイン
          </button>
          <button
            onClick={() => setMode('sign-up')}
            className={`rounded-md px-3 py-2 text-sm font-bold ${
              mode === 'sign-up' ? 'bg-white text-slate-900 shadow' : 'text-slate-600'
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
