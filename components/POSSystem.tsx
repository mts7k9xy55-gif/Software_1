'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

// 型定義
interface MenuItem {
  id: number
  name: string
  price: number
  tax_rate: number
  image_url?: string
  shop_id: string
  only_takeout?: boolean
  only_eat_in?: boolean
}

interface SaleRecord {
  id: number
  items: { id: number; name: string; price: number; quantity: number; tax_rate: number }[]
  total_amount: number
  created_at: string
  shop_id: string
}

export default function POSSystem() {
  const { user, shopId, shopName, signOut, updateShopName } = useAuth()
  const [mode, setMode] = useState<'register' | 'admin' | 'tax'>('register')
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [salesData, setSalesData] = useState<SaleRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // 税務申告用
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [periodSales, setPeriodSales] = useState<SaleRecord[]>([])

  // 税率タブ: テイクアウト(8%) or 店内飲食(10%)
  const [taxMode, setTaxMode] = useState<'takeout' | 'dine-in'>('dine-in')

  // 商品登録用
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newImageFile, setNewImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [newOnlyTakeout, setNewOnlyTakeout] = useState(false)
  const [newOnlyEatIn, setNewOnlyEatIn] = useState(false)

  // 店舗名入力モーダル
  const [showShopNameModal, setShowShopNameModal] = useState(false)
  const [shopNameInput, setShopNameInput] = useState('')
  const [skipShopNamePrompt, setSkipShopNamePrompt] = useState(false)

  // 店舗名未設定時にモーダル表示
  useEffect(() => {
    if (shopId && !isLoading && shopName === null && !skipShopNamePrompt) {
      setShowShopNameModal(true)
    }
  }, [shopId, isLoading, shopName, skipShopNamePrompt])

  // データ取得
  useEffect(() => {
    if (shopId) {
      fetchMenuItems()
      fetchTodaySales()
    }
  }, [shopId])

  const fetchMenuItems = async () => {
    if (!shopId) return
    const { data } = await supabase
      .from('menu_items')
      .select('id, name, price, tax_rate, image_url, shop_id, only_takeout, only_eat_in')
      .eq('shop_id', shopId)
      .order('name')
    setMenuItems(data || [])
    setIsLoading(false)
  }

  // 商品削除
  const deleteMenuItem = async (id: number) => {
    if (!confirm('この商品を削除しますか？')) return
    
    const { error } = await supabase
      .from('menu_items')
      .delete()
      .eq('id', id)
    
    if (error) {
      alert('削除エラー: ' + error.message)
    } else {
      fetchMenuItems()
    }
  }

  // 商品の非表示フラグを更新
  const updateItemVisibility = async (id: number, field: 'only_takeout' | 'only_eat_in', value: boolean) => {
    const { error } = await supabase
      .from('menu_items')
      .update({ [field]: value })
      .eq('id', id)
    
    if (error) {
      alert('更新エラー: ' + error.message)
    } else {
      fetchMenuItems()
    }
  }

  // 店舗名を保存
  const handleShopNameSubmit = async () => {
    if (!shopNameInput.trim()) return
    const { error } = await updateShopName(shopNameInput.trim())
    if (error) {
      alert('保存エラー: ' + error.message)
    } else {
      setShowShopNameModal(false)
      setShopNameInput('')
    }
  }

  // 税率タブに応じてフィルタリングされた商品リスト
  const filteredMenuItems = menuItems.filter(item => {
    if (taxMode === 'takeout') {
      // テイクアウト時: only_eat_in が true の商品を除外
      return !item.only_eat_in
    } else {
      // 店内飲食時: only_takeout が true の商品を除外
      return !item.only_takeout
    }
  })

  const fetchTodaySales = async () => {
    if (!shopId) return
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('sales')
      .select('*')
      .eq('shop_id', shopId)
      .gte('created_at', today)
      .order('created_at', { ascending: false })
    setSalesData(data || [])
  }

  // 期間指定で売上取得
  const fetchPeriodSales = async () => {
    if (!shopId || !startDate || !endDate) return
    const { data } = await supabase
      .from('sales')
      .select('*')
      .eq('shop_id', shopId)
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59')
      .order('created_at', { ascending: false })
    setPeriodSales(data || [])
  }

  // 期間集計計算
  const getPeriodStats = () => {
    let totalSales = 0
    let tax8Total = 0
    let tax10Total = 0
    let tax8Amount = 0
    let tax10Amount = 0

    periodSales.forEach(sale => {
      totalSales += sale.total_amount
      if (sale.items) {
        sale.items.forEach(item => {
          const subtotal = item.price * item.quantity
          const tax = subtotal * (item.tax_rate / 100)
          if (item.tax_rate === 8) {
            tax8Total += subtotal
            tax8Amount += tax
          } else {
            tax10Total += subtotal
            tax10Amount += tax
          }
        })
      }
    })

    return { totalSales, tax8Total, tax10Total, tax8Amount, tax10Amount }
  }

  // PDF出力
  const exportPDF = async () => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF()
    const stats = getPeriodStats()

    // 日本語フォント対応のため、デフォルトフォントを使用
    doc.setFont('helvetica')
    doc.setFontSize(16)
    doc.text(shopName || 'POS System', 14, 20)
    doc.setFontSize(12)
    doc.text(`Tax Report: ${startDate} - ${endDate}`, 14, 30)

    // 税率別集計テーブル
    autoTable(doc, {
      startY: 40,
      head: [['Tax Rate', 'Subtotal (excl. tax)', 'Tax Amount', 'Total (incl. tax)']],
      body: [
        [
          '8% (Takeout)',
          `¥${Math.floor(stats.tax8Total).toLocaleString()}`,
          `¥${Math.floor(stats.tax8Amount).toLocaleString()}`,
          `¥${Math.floor(stats.tax8Total + stats.tax8Amount).toLocaleString()}`
        ],
        [
          '10% (Dine-in)',
          `¥${Math.floor(stats.tax10Total).toLocaleString()}`,
          `¥${Math.floor(stats.tax10Amount).toLocaleString()}`,
          `¥${Math.floor(stats.tax10Total + stats.tax10Amount).toLocaleString()}`
        ],
        [
          'Total',
          `¥${Math.floor(stats.tax8Total + stats.tax10Total).toLocaleString()}`,
          `¥${Math.floor(stats.tax8Amount + stats.tax10Amount).toLocaleString()}`,
          `¥${stats.totalSales.toLocaleString()}`
        ]
      ]
    })

    doc.save(`tax-report-${startDate}-${endDate}.pdf`)
  }

  // 商品クリックで即座に売上記録（税率はタブで自動決定）
  const recordSale = async (item: MenuItem) => {
    if (!shopId) return
    
    // タブに応じて税率を自動適用
    const appliedTaxRate = taxMode === 'takeout' ? 8 : 10
    
    const subtotal = item.price
    const tax = subtotal * (appliedTaxRate / 100)
    const total = subtotal + tax

    const saleData = {
      shop_id: shopId,
      items: [{
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: 1,
        tax_rate: appliedTaxRate
      }],
      total_amount: Math.floor(total),
      tax_details: {
        [appliedTaxRate]: { subtotal, tax }
      }
    }

    const { error } = await supabase.from('sales').insert(saleData)
    
    if (error) {
      alert('記録エラー: ' + error.message)
    } else {
      fetchTodaySales()
    }
  }

  // 画像ファイル選択時の処理
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setNewImageFile(file)
      // プレビュー表示用
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  // 画像をSupabase Storageにアップロード
  const uploadImage = async (file: File): Promise<string | null> => {
    const fileExt = file.name.split('.').pop()
    const fileName = `${shopId}/${Date.now()}.${fileExt}`
    
    const { error } = await supabase.storage
      .from('product-images')
      .upload(fileName, file)
    
    if (error) {
      console.error('Upload error:', error)
      return null
    }
    
    const { data: { publicUrl } } = supabase.storage
      .from('product-images')
      .getPublicUrl(fileName)
    
    return publicUrl
  }

  // 商品登録
  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName || !newPrice || !shopId) return

    setIsUploading(true)
    let imageUrl: string | null = null

    // 画像がある場合はアップロード
    if (newImageFile) {
      imageUrl = await uploadImage(newImageFile)
      if (!imageUrl) {
        alert('画像のアップロードに失敗しました')
        setIsUploading(false)
        return
      }
    }

    const { error } = await supabase.from('menu_items').insert({
      shop_id: shopId,
      name: newName,
      price: parseInt(newPrice),
      tax_rate: 10,
      category: 'その他',
      image_url: imageUrl,
      only_takeout: newOnlyTakeout,
      only_eat_in: newOnlyEatIn
    })

    setIsUploading(false)

    if (error) {
      alert('登録エラー: ' + error.message)
    } else {
      setNewName('')
      setNewPrice('')
      setNewImageFile(null)
      setImagePreview(null)
      setNewOnlyTakeout(false)
      setNewOnlyEatIn(false)
      fetchMenuItems()
    }
  }

  // 今日の集計計算
  const getTodayStats = () => {
    let totalSales = 0
    let tax8Total = 0
    let tax10Total = 0
    let tax8Amount = 0
    let tax10Amount = 0

    salesData.forEach(sale => {
      totalSales += sale.total_amount
      if (sale.items) {
        sale.items.forEach(item => {
          const subtotal = item.price * item.quantity
          const tax = subtotal * (item.tax_rate / 100)
          if (item.tax_rate === 8) {
            tax8Total += subtotal
            tax8Amount += tax
          } else {
            tax10Total += subtotal
            tax10Amount += tax
          }
        })
      }
    })

    return { totalSales, tax8Total, tax10Total, tax8Amount, tax10Amount }
  }

  const stats = getTodayStats()

  // 時刻フォーマット
  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }

  // 現在の税率
  const currentTaxRate = taxMode === 'takeout' ? 8 : 10

  if (isLoading) {
    return <div className="p-10 text-center">読み込み中...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 店舗名入力モーダル */}
      {showShopNameModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h2 className="text-xl font-bold mb-4">🏠 店舗名を設定してください</h2>
            <p className="text-gray-600 mb-4">ヘッダーに「○○ 専用POS」と表示されます。</p>
            <input
              type="text"
              value={shopNameInput}
              onChange={(e) => setShopNameInput(e.target.value)}
              placeholder="例: カフェABC"
              className="w-full p-3 border rounded mb-4 text-lg"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleShopNameSubmit}
                disabled={!shopNameInput.trim()}
                className="flex-1 py-3 bg-blue-600 text-white font-bold rounded disabled:bg-gray-300"
              >
                保存する
              </button>
              <button
                onClick={() => {
                  setShowShopNameModal(false)
                  setSkipShopNamePrompt(true)
                  setShopNameInput('')
                }}
                className="flex-1 py-3 border rounded font-bold text-gray-600 hover:bg-gray-50"
              >
                今はスキップ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 最上部：税率タブ（大きく目立つ） */}
      <div className="sticky top-0 z-10 bg-white shadow-md">
        <div className="max-w-6xl mx-auto">
          <div className="flex">
            <button
              onClick={() => setTaxMode('takeout')}
              className={`flex-1 py-5 text-xl font-bold transition-colors ${
                taxMode === 'takeout' 
                  ? 'bg-orange-500 text-white' 
                  : 'bg-gray-100 text-gray-600 hover:bg-orange-100'
              }`}
            >
              🥡 テイクアウト (8%)
            </button>
            <button
              onClick={() => setTaxMode('dine-in')}
              className={`flex-1 py-5 text-xl font-bold transition-colors ${
                taxMode === 'dine-in' 
                  ? 'bg-green-600 text-white' 
                  : 'bg-gray-100 text-gray-600 hover:bg-green-100'
              }`}
            >
              🍽️ 店内飲食 (10%)
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4">
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-xl font-bold">
              {shopName ? `${shopName} 専用POS` : '売上記録システム'}
            </h1>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
          <div className="flex gap-2">
            {!shopName && (
              <button
                onClick={() => setShowShopNameModal(true)}
                className="px-4 py-2 text-orange-600 border border-orange-300 rounded hover:bg-orange-50"
              >
                🏠 店舗名設定
              </button>
            )}
            <button
              onClick={() => setMode('register')}
              className={`px-4 py-2 font-bold rounded ${mode === 'register' ? 'bg-blue-600 text-white' : 'bg-white border'}`}
            >
              売上を記録
            </button>
            <button
              onClick={() => setMode('admin')}
              className={`px-4 py-2 font-bold rounded ${mode === 'admin' ? 'bg-blue-600 text-white' : 'bg-white border'}`}
            >
              商品管理
            </button>
            <button
              onClick={() => setMode('tax')}
              className={`px-4 py-2 font-bold rounded ${mode === 'tax' ? 'bg-blue-600 text-white' : 'bg-white border'}`}
            >
              📊 税務申告
            </button>
            <button
              onClick={signOut}
              className="px-4 py-2 text-gray-600 border rounded hover:bg-gray-100"
            >
              ログアウト
            </button>
          </div>
        </div>

        {mode === 'register' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 左: 商品ボタンGrid（写真付き） */}
            <div className="bg-white p-4 rounded shadow">
              {/* 現在の税率表示 */}
              <div className={`text-center py-2 mb-4 rounded ${taxMode === 'takeout' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                現在: <span className="font-bold text-lg">{taxMode === 'takeout' ? '🥡 テイクアウト' : '🍽️ 店内飲食'}</span>
                （税率 {currentTaxRate}%）
              </div>

              <h2 className="font-bold text-lg mb-3 border-b pb-2">
                商品をタップして記録
              </h2>
              
              {filteredMenuItems.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  {menuItems.length === 0 ? '商品がありません。「商品管理」から登録してください。' : 'このタブで表示可能な商品がありません。'}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
                  {filteredMenuItems.map(item => {
                    const taxIncludedPrice = Math.floor(item.price * (1 + currentTaxRate / 100))
                    return (
                      <button
                        key={item.id}
                        onClick={() => recordSale(item)}
                        className="border-2 rounded-lg overflow-hidden hover:shadow-lg hover:border-blue-400 transition-all bg-white active:scale-95"
                      >
                        {/* 商品画像 */}
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.name}
                            className="w-full h-28 object-cover"
                          />
                        ) : (
                          <div className="w-full h-28 bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-4xl">
                            🍽️
                          </div>
                        )}
                        {/* 商品情報 */}
                        <div className="p-2">
                          <div className="font-bold text-sm truncate">{item.name}</div>
                          <div className="text-green-600 font-bold text-lg">
                            ¥{taxIncludedPrice.toLocaleString()}
                          </div>
                          <div className="text-xs text-gray-500">
                            (税抜 ¥{item.price.toLocaleString()})
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 右: 今日の売上履歴（帳簿） */}
            <div className="space-y-4">
              {/* 本日合計 */}
              <div className="bg-blue-600 text-white p-4 rounded shadow">
                <p className="text-sm opacity-80">本日の売上合計</p>
                <p className="text-3xl font-bold">¥{stats.totalSales.toLocaleString()}</p>
                <p className="text-sm opacity-80 mt-1">{salesData.length}件の記録</p>
              </div>

              {/* 税率別集計 */}
              <div className="bg-white p-4 rounded shadow">
                <h3 className="font-bold mb-3 border-b pb-2">税率別集計</h3>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2">区分</th>
                      <th className="text-right p-2">税抜</th>
                      <th className="text-right p-2">消費税</th>
                      <th className="text-right p-2">税込</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="p-2">🥡 テイクアウト(8%)</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Total).toLocaleString()}</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Amount).toLocaleString()}</td>
                      <td className="p-2 text-right font-bold">¥{Math.floor(stats.tax8Total + stats.tax8Amount).toLocaleString()}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="p-2">🍽️ 店内飲食(10%)</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax10Total).toLocaleString()}</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax10Amount).toLocaleString()}</td>
                      <td className="p-2 text-right font-bold">¥{Math.floor(stats.tax10Total + stats.tax10Amount).toLocaleString()}</td>
                    </tr>
                    <tr className="bg-gray-50 font-bold">
                      <td className="p-2">合計</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Total + stats.tax10Total).toLocaleString()}</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Amount + stats.tax10Amount).toLocaleString()}</td>
                      <td className="p-2 text-right">¥{stats.totalSales.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 売上履歴（帳簿） */}
              <div className="bg-white p-4 rounded shadow">
                <div className="flex justify-between items-center mb-3 border-b pb-2">
                  <h3 className="font-bold">今日の売上履歴（帳簿）</h3>
                  <button onClick={fetchTodaySales} className="text-blue-600 text-sm hover:underline">
                    更新
                  </button>
                </div>
                
                <div className="overflow-y-auto max-h-48">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">時刻</th>
                        <th className="text-center p-2">区分</th>
                        <th className="text-left p-2">商品</th>
                        <th className="text-right p-2">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesData.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-gray-400">
                            まだ記録がありません
                          </td>
                        </tr>
                      ) : (
                        salesData.map(sale => {
                          const taxRate = sale.items?.[0]?.tax_rate
                          const isTakeout = taxRate === 8
                          return (
                            <tr key={sale.id} className="border-b hover:bg-gray-50">
                              <td className="p-2 text-gray-600">{formatTime(sale.created_at)}</td>
                              <td className="p-2 text-center text-lg">
                                {isTakeout ? '🥡' : '🍽️'}
                              </td>
                              <td className="p-2">
                                {sale.items?.map((item, i) => (
                                  <span key={i}>{item.name}</span>
                                ))}
                              </td>
                              <td className="p-2 text-right font-bold">
                                ¥{sale.total_amount.toLocaleString()}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : mode === 'admin' ? (
          /* 商品管理モード */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 商品登録 */}
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold text-lg mb-4 border-b pb-2">商品登録</h2>
              <form onSubmit={handleProductSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold mb-1">商品名</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full p-2 border rounded"
                    placeholder="例: コーヒー"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">価格（税抜）</label>
                  <input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="w-full p-2 border rounded"
                    placeholder="500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">商品画像（任意）</label>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageChange}
                    className="w-full p-2 border rounded bg-white"
                  />
                  {imagePreview && (
                    <div className="mt-2">
                      <img 
                        src={imagePreview} 
                        alt="プレビュー" 
                        className="w-24 h-24 object-cover rounded border"
                      />
                    </div>
                  )}
                </div>
                <div className="border rounded p-3 bg-gray-50">
                  <label className="block text-sm font-bold mb-2">表示制限（任意）</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newOnlyTakeout}
                        onChange={(e) => {
                          setNewOnlyTakeout(e.target.checked)
                          if (e.target.checked) setNewOnlyEatIn(false)
                        }}
                        className="w-5 h-5"
                      />
                      <span>🥡 テイクアウトのみ</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newOnlyEatIn}
                        onChange={(e) => {
                          setNewOnlyEatIn(e.target.checked)
                          if (e.target.checked) setNewOnlyTakeout(false)
                        }}
                        className="w-5 h-5"
                      />
                      <span>🍽️ 店内飲食のみ</span>
                    </label>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isUploading}
                  className={`w-full py-3 text-white font-bold rounded ${isUploading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {isUploading ? '📤 アップロード中...' : '商品を登録'}
                </button>
              </form>
              <p className="text-sm text-gray-500 mt-4 bg-gray-50 p-3 rounded">
                💡 税率は画面上部の「テイクアウト/店内飲食」タブで自動適用されます
              </p>
            </div>

            {/* 登録済み商品一覧 */}
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold text-lg mb-4 border-b pb-2">登録済み商品</h2>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {menuItems.map(item => (
                  <div key={item.id} className="p-3 border rounded">
                    <div className="flex items-center gap-3">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-12 h-12 object-cover rounded" />
                      ) : (
                        <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-xl">🍽️</div>
                      )}
                      <div className="flex-1">
                        <div className="font-bold">{item.name}</div>
                        <div className="text-sm text-gray-600">税抜 ¥{item.price.toLocaleString()}</div>
                      </div>
                      <button
                        onClick={() => deleteMenuItem(item.id)}
                        className="px-3 py-1 text-red-600 hover:bg-red-50 rounded border border-red-200"
                      >
                        🗑️ 削除
                      </button>
                    </div>
                    {/* 表示制限トグル */}
                    <div className="mt-2 pt-2 border-t flex gap-2">
                      <button
                        onClick={() => updateItemVisibility(item.id, 'only_takeout', !item.only_takeout)}
                        className={`px-3 py-1 text-sm rounded border ${item.only_takeout ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:border-orange-400'}`}
                      >
                        🥡 テイクアウトのみ
                      </button>
                      <button
                        onClick={() => updateItemVisibility(item.id, 'only_eat_in', !item.only_eat_in)}
                        className={`px-3 py-1 text-sm rounded border ${item.only_eat_in ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'}`}
                      >
                        🍽️ 店内飲食のみ
                      </button>
                      {!item.only_takeout && !item.only_eat_in && (
                        <span className="text-xs text-gray-400 self-center">← 両方に表示</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* 税務申告モード */
          <div className="bg-white p-6 rounded shadow max-w-4xl mx-auto">
            <h2 className="font-bold text-2xl mb-6 border-b pb-3">📊 税務申告レポート</h2>
            
            {/* 期間選択 */}
            <div className="mb-6 p-4 bg-gray-50 rounded">
              <h3 className="font-bold mb-3">期間を選択</h3>
              <div className="flex gap-4 items-end">
                <div>
                  <label className="block text-sm mb-1">開始日</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="p-2 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">終了日</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="p-2 border rounded"
                  />
                </div>
                <button
                  onClick={fetchPeriodSales}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  集計
                </button>
              </div>
            </div>

            {/* 集計結果 */}
            {periodSales.length > 0 && (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 rounded border border-green-200">
                  <h3 className="font-bold text-lg mb-3">税率別集計</h3>
                  <div className="space-y-2">
                    {(() => {
                      const stats = getPeriodStats()
                      return (
                        <>
                          <div className="grid grid-cols-4 gap-2 font-bold border-b pb-2">
                            <div>区分</div>
                            <div className="text-right">税抜売上</div>
                            <div className="text-right">消費税額</div>
                            <div className="text-right">税込合計</div>
                          </div>
                          <div className="grid grid-cols-4 gap-2 py-2">
                            <div>🥡 8% (テイクアウト)</div>
                            <div className="text-right">¥{Math.floor(stats.tax8Total).toLocaleString()}</div>
                            <div className="text-right">¥{Math.floor(stats.tax8Amount).toLocaleString()}</div>
                            <div className="text-right font-bold">¥{Math.floor(stats.tax8Total + stats.tax8Amount).toLocaleString()}</div>
                          </div>
                          <div className="grid grid-cols-4 gap-2 py-2">
                            <div>🍽️ 10% (店内飲食)</div>
                            <div className="text-right">¥{Math.floor(stats.tax10Total).toLocaleString()}</div>
                            <div className="text-right">¥{Math.floor(stats.tax10Amount).toLocaleString()}</div>
                            <div className="text-right font-bold">¥{Math.floor(stats.tax10Total + stats.tax10Amount).toLocaleString()}</div>
                          </div>
                          <div className="grid grid-cols-4 gap-2 py-2 border-t font-bold text-lg">
                            <div>合計</div>
                            <div className="text-right">¥{Math.floor(stats.tax8Total + stats.tax10Total).toLocaleString()}</div>
                            <div className="text-right">¥{Math.floor(stats.tax8Amount + stats.tax10Amount).toLocaleString()}</div>
                            <div className="text-right">¥{stats.totalSales.toLocaleString()}</div>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* PDF出力ボタン */}
                <button
                  onClick={exportPDF}
                  className="w-full py-3 bg-red-600 text-white rounded font-bold hover:bg-red-700 flex items-center justify-center gap-2"
                >
                  📄 PDF出力（税務申告用）
                </button>

                {/* 売上明細 */}
                <div className="border rounded">
                  <div className="p-3 bg-gray-100 border-b font-bold">
                    売上明細（{periodSales.length}件）
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr className="border-b">
                          <th className="text-left p-2">日時</th>
                          <th className="text-center p-2">区分</th>
                          <th className="text-left p-2">商品</th>
                          <th className="text-right p-2">金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodSales.map(sale => {
                          const taxRate = sale.items?.[0]?.tax_rate
                          const isTakeout = taxRate === 8
                          return (
                            <tr key={sale.id} className="border-b hover:bg-gray-50">
                              <td className="p-2 text-gray-600">{new Date(sale.created_at).toLocaleString('ja-JP')}</td>
                              <td className="p-2 text-center text-lg">
                                {isTakeout ? '🥡' : '🍽️'}
                              </td>
                              <td className="p-2">
                                {sale.items?.map((item, i) => (
                                  <span key={i}>{item.name} ×{item.quantity}</span>
                                )).reduce((prev, curr) => [prev, ', ', curr] as any)}
                              </td>
                              <td className="p-2 text-right font-bold">
                                ¥{sale.total_amount.toLocaleString()}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
