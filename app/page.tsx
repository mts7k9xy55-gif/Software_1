'use client'

import { useUser } from '@clerk/nextjs'
import FilingOrchestratorApp from '@/components/FilingOrchestratorApp'
import LoginForm from '@/components/LoginForm'

export default function Home() {
  const { user, isLoaded } = useUser()
  const loading = !isLoaded

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">読み込み中...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginForm />
  }

  return <FilingOrchestratorApp />
}
