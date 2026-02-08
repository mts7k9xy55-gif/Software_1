'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { isInvalidUuidError, toDeterministicUuid } from '@/lib/supabaseHelpers'
import { useClerk, useUser } from '@clerk/nextjs'

export interface AppUser {
  id: string
  email: string | null
}

interface AuthContextType {
  user: AppUser | null
  shopId: string | null
  shopName: string | null
  loading: boolean
  signOut: () => Promise<void>
  updateShopName: (name: string) => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, user: clerkUser } = useUser()
  const { signOut: clerkSignOut } = useClerk()

  const [shopName, setShopName] = useState<string | null>(null)
  const [shopNameLoading, setShopNameLoading] = useState(true)

  const user: AppUser | null = clerkUser
    ? {
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      }
    : null

  useEffect(() => {
    const shopId = user?.id ?? null

    if (!isLoaded) return

    if (!shopId) {
      setShopName(null)
      setShopNameLoading(false)
      return
    }

    const fetchShopName = async (userId: string) => {
      setShopNameLoading(true)

      let { data, error } = await supabase
        .from('shops')
        .select('name')
        .eq('id', userId)
        .maybeSingle()

      if (isInvalidUuidError(error)) {
        const fallbackId = toDeterministicUuid(userId)
        const retry = await supabase.from('shops').select('name').eq('id', fallbackId).maybeSingle()
        data = retry.data
        error = retry.error
      }

      if (error) {
        setShopName(null)
        setShopNameLoading(false)
        return
      }

      setShopName(data?.name ?? null)
      setShopNameLoading(false)
    }

    fetchShopName(shopId)
  }, [isLoaded, user?.id])

  // 店舗名を更新
  const updateShopName = async (name: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    let payload = { id: user.id, name }
    let { error } = await supabase
      .from('shops')
      .upsert(payload, { onConflict: 'id' })

    if (isInvalidUuidError(error)) {
      payload = { id: toDeterministicUuid(user.id), name }
      const retry = await supabase.from('shops').upsert(payload, { onConflict: 'id' })
      error = retry.error
    }

    if (!error) {
      setShopName(name)
    }
    return { error: error as Error | null }
  }

  const signOut = async () => {
    await clerkSignOut()
  }

  // shopId = user.id（店主ごとに一意）
  const shopId = user?.id ?? null
  const loading = !isLoaded || shopNameLoading

  return (
    <AuthContext.Provider value={{ user, shopId, shopName, loading, signOut, updateShopName }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
