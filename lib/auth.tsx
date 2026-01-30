'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { User } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  shopId: string | null
  shopName: string | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  updateShopName: (name: string) => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [shopName, setShopName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const persistSession = (session: any) => {
      if (typeof window === 'undefined') return
      if (session) {
        window.localStorage.setItem('pos-auth-token', JSON.stringify(session))
      }
    }

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session && session.expires_at && session.expires_at * 1000 > Date.now()) {
        setUser(session.user)
        fetchShopName(session.user.id)
        persistSession(session)
      } else {
        setUser(null)
        setShopName(null)
      }
      setLoading(false)
    }

    init()

    // 認証状態の変化を監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        persistSession(session)
      }
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchShopName(session.user.id)
      } else {
        setShopName(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // 店舗名を取得
  const fetchShopName = async (userId: string) => {
    const { data, error } = await supabase
      .from('shops')
      .select('name')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      setShopName(null)
      return
    }

    setShopName(data?.name ?? null)
  }

  // 店舗名を更新
  const updateShopName = async (name: string) => {
    if (!user) return { error: new Error('Not authenticated') }

    const { error } = await supabase
      .from('shops')
      .upsert({ id: user.id, name }, { onConflict: 'id' })

    if (!error) {
      setShopName(name)
    }
    return { error: error as Error | null }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error as Error | null }
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error: error as Error | null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  // shopId = user.id（店主ごとに一意）
  const shopId = user?.id ?? null

  return (
    <AuthContext.Provider value={{ user, shopId, shopName, loading, signIn, signUp, signOut, updateShopName }}>
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
