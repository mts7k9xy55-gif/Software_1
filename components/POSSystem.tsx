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
}

interface SaleRecord {
  id: number
  items: { id: number; name: string; price: number; quantity: number; tax_rate: number }[]
  total_amount: number
  created_at: string
  shop_id: string
}

export default function POSSystem() {
  const { user, shopId, signOut } = useAuth()
  const [mode, setMode] = useState<'register' | 'admin'>('register')
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [salesData, setSalesData] = useState<SaleRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // 税率タブ: テイクアウト(8%) or 店内飲食(10%)
  const [taxMode, setTaxMode] = useState<'takeout' | 'dine-in'>('dine-in')

  // 商品登録用
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newImageUrl, setNewImageUrl] = useState('')

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
      .select('id, name, price, tax_rate, image_url, shop_id')
      .eq('shop_id', shopId)
      .order('name')
    setMenuItems(data || [])
    setIsLoading(false)
  }

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

  // 商品登録
  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName || !newPrice || !shopId) return

    const { error } = await supabase.from('menu_items').insert({
      shop_id: shopId,
      name: newName,
      price: parseInt(newPrice),
      tax_rate: 10,
      category: 'その他',
      image_url: newImageUrl || null
    })

    if (error) {
      alert('登録エラー: ' + error.message)
    } else {
      setNewName('')
      setNewPrice('')
      setNewImageUrl('')
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
            <h1 className="text-xl font-bold">売上記録システム</h1>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
          <div className="flex gap-2">
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
              
              {menuItems.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  商品がありません。「商品管理」から登録してください。
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
                  {menuItems.map(item => {
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
        ) : (
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
                  <label className="block text-sm font-bold mb-1">商品画像URL（任意）</label>
                  <input
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    className="w-full p-2 border rounded"
                    placeholder="https://example.com/image.jpg"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded"
                >
                  商品を登録
                </button>
              </form>
              <p className="text-sm text-gray-500 mt-4 bg-gray-50 p-3 rounded">
                💡 税率は画面上部の「テイクアウト/店内飲食」タブで自動適用されます
              </p>
            </div>

            {/* 登録済み商品一覧 */}
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold text-lg mb-4 border-b pb-2">登録済み商品</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {menuItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-2 border rounded">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name} className="w-12 h-12 object-cover rounded" />
                    ) : (
                      <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-xl">🍽️</div>
                    )}
                    <div className="flex-1">
                      <div className="font-bold">{item.name}</div>
                      <div className="text-sm text-gray-600">税抜 ¥{item.price.toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
