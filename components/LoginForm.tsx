'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth'

export default function LoginForm() {
  const { signIn, signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = isSignUp 
      ? await signUp(email, password)
      : await signIn(email, password)

    if (error) {
      setError(error.message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
        <h1 className="text-2xl font-bold text-center mb-6">
          売上記録システム
        </h1>
        <p className="text-gray-600 text-center mb-6">
          {isSignUp ? '新規登録' : 'ログイン'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold mb-1">メールアドレス</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 border rounded"
              placeholder="shop@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 border rounded"
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          {error && (
            <div className="bg-red-100 text-red-700 p-3 rounded text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white font-bold rounded disabled:bg-gray-400"
          >
            {loading ? '処理中...' : (isSignUp ? '新規登録' : 'ログイン')}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-blue-600 text-sm hover:underline"
          >
            {isSignUp ? 'すでにアカウントをお持ちの方' : '新規登録はこちら'}
          </button>
        </div>
      </div>
    </div>
  )
}
