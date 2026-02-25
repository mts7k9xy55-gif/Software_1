'use client'

import { useEffect, useMemo, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import ExecutiveDashboard from '@/components/dashboard/ExecutiveDashboard'
import LoginForm from '@/components/LoginForm'
import DoorPage from '@/components/DoorPage'
import { DEFAULT_REGION_CODE, getRegionDefinition, isRegionCode, type RegionCode } from '@/lib/core/regions'

const REGION_STORAGE_KEY = 'taxman:selected_region'

export default function Home() {
  const { user, isLoaded } = useUser()
  const [selectedRegion, setSelectedRegion] = useState<RegionCode>(DEFAULT_REGION_CODE)
  const [entered, setEntered] = useState(false)
  const loading = !isLoaded
  const region = useMemo(() => getRegionDefinition(selectedRegion), [selectedRegion])

  useEffect(() => {
    if (!user) return
    const saved = window.localStorage.getItem(REGION_STORAGE_KEY)
    if (saved && isRegionCode(saved)) {
      setSelectedRegion(saved)
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    window.localStorage.setItem(REGION_STORAGE_KEY, selectedRegion)
  }, [selectedRegion, user])

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

  if (!entered) {
    return (
      <DoorPage
        selectedRegion={selectedRegion}
        onSelectRegion={setSelectedRegion}
        onEnter={() => setEntered(true)}
      />
    )
  }

  return <ExecutiveDashboard region={region} onSwitchRegion={() => setEntered(false)} />
}
