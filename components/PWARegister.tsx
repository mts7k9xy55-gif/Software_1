'use client'

import { useEffect } from 'react'

export default function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js')
      } catch {
        // keep silent; app must work even when SW registration fails
      }
    }

    void register()
  }, [])

  return null
}
