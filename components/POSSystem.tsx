'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// 型定義
interface MenuItem {
  id: number
  name: string
  price: number
  tax_rate: number
}

interface SaleRecord {
  id: number
  items: { id: number; name: string; price: number; quantity: number; tax_rate: number }[]
  total_amount: number
  created_at: string
}

export default function POSSystem() {
  const [mode, setMode] = useState<'register' | 'admin'>('register')
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [salesData, setSalesData] = useState<SaleRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // 売上入力用
  const [selectedItem, setSelectedItem] = useState<string>('')
  const [quantity, setQuantity] = useState<number>(1)
  const [isProcessing, setIsProcessing] = useState(false)

  // 商品登録用
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newTaxRate, setNewTaxRate] = useState('10')

  // データ取得
  useEffect(() => {
    fetchMenuItems()
    fetchTodaySales()
  }, [])

  const fetchMenuItems = async () => {
    const { data } = await supabase
      .from('menu_items')
      .select('id, name, price, tax_rate')
      .order('name')
    setMenuItems(data || [])
    setIsLoading(false)
  }

  const fetchTodaySales = async () => {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('sales')
      .select('*')
      .gte('created_at', today)
      .order('created_at', { ascending: false })
    setSalesData(data || [])
  }

  // 売上登録
  const handleSaleSubmit = async () => {
    if (!selectedItem || quantity < 1) return
    setIsProcessing(true)

    const item = menuItems.find(m => m.id === parseInt(selectedItem))
    if (!item) {
      setIsProcessing(false)
      return
    }

    const subtotal = item.price * quantity
    const tax = subtotal * (item.tax_rate / 100)
    const total = subtotal + tax

    const saleData = {
      items: [{
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: quantity,
        tax_rate: item.tax_rate
      }],
      total_amount: Math.floor(total),
      tax_details: {
        [item.tax_rate]: { subtotal, tax }
      }
    }

    const { error } = await supabase.from('sales').insert(saleData)
    
    setIsProcessing(false)
    if (error) {
      alert('登録エラー: ' + error.message)
    } else {
      setSelectedItem('')
      setQuantity(1)
      fetchTodaySales()
    }
  }

  // 商品登録
  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName || !newPrice) return

    const { error } = await supabase.from('menu_items').insert({
      name: newName,
      price: parseInt(newPrice),
      tax_rate: parseInt(newTaxRate),
      category: 'その他'
    })

    if (error) {
      alert('登録エラー: ' + error.message)
    } else {
      setNewName('')
      setNewPrice('')
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

  if (isLoading) {
    return <div className="p-10 text-center">読み込み中...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        {/* タブ切り替え */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('register')}
            className={`px-6 py-2 font-bold rounded ${mode === 'register' ? 'bg-blue-600 text-white' : 'bg-white border'}`}
          >
            レジ
          </button>
          <button
            onClick={() => setMode('admin')}
            className={`px-6 py-2 font-bold rounded ${mode === 'admin' ? 'bg-blue-600 text-white' : 'bg-white border'}`}
          >
            管理
          </button>
        </div>

        {mode === 'register' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 左: 売上入力 */}
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold text-lg mb-4 border-b pb-2">売上入力</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold mb-1">商品</label>
                  <select
                    value={selectedItem}
                    onChange={(e) => setSelectedItem(e.target.value)}
                    className="w-full p-3 border rounded text-lg"
                  >
                    <option value="">-- 選択 --</option>
                    {menuItems.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name} (¥{item.price} / {item.tax_rate}%)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold mb-1">数量</label>
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                    className="w-full p-3 border rounded text-lg text-center"
                  />
                </div>

                {selectedItem && (
                  <div className="bg-gray-100 p-3 rounded text-center">
                    <p className="text-sm text-gray-600">合計（税込）</p>
                    <p className="text-2xl font-bold">
                      ¥{(() => {
                        const item = menuItems.find(m => m.id === parseInt(selectedItem))
                        if (!item) return 0
                        const subtotal = item.price * quantity
                        return Math.floor(subtotal * (1 + item.tax_rate / 100)).toLocaleString()
                      })()}
                    </p>
                  </div>
                )}

                <button
                  onClick={handleSaleSubmit}
                  disabled={!selectedItem || isProcessing}
                  className="w-full py-4 bg-green-600 text-white font-bold text-lg rounded disabled:bg-gray-300"
                >
                  {isProcessing ? '処理中...' : '売上登録'}
                </button>
              </div>
            </div>

            {/* 中央: 本日の売上明細 */}
            <div className="bg-white p-4 rounded shadow">
              <div className="flex justify-between items-center mb-4 border-b pb-2">
                <h2 className="font-bold text-lg">本日の売上明細</h2>
                <button onClick={fetchTodaySales} className="text-blue-600 text-sm">更新</button>
              </div>
              
              <div className="overflow-y-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left p-2">時刻</th>
                      <th className="text-left p-2">商品</th>
                      <th className="text-right p-2">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesData.length === 0 ? (
                      <tr><td colSpan={3} className="p-4 text-center text-gray-400">データなし</td></tr>
                    ) : (
                      salesData.map(sale => (
                        <tr key={sale.id} className="border-b">
                          <td className="p-2">{formatTime(sale.created_at)}</td>
                          <td className="p-2">
                            {sale.items?.map((item, i) => (
                              <span key={i}>{item.name}×{item.quantity}{i < sale.items.length - 1 ? ', ' : ''}</span>
                            ))}
                          </td>
                          <td className="p-2 text-right font-bold">¥{sale.total_amount.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 右: 税率別集計 */}
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold text-lg mb-4 border-b pb-2">本日の集計</h2>
              
              <div className="space-y-4">
                {/* 合計 */}
                <div className="bg-blue-50 p-4 rounded">
                  <p className="text-sm text-gray-600">売上合計（税込）</p>
                  <p className="text-3xl font-bold text-blue-700">¥{stats.totalSales.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-1">取引数: {salesData.length}件</p>
                </div>

                {/* 税率別 */}
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="text-left p-2">税率</th>
                      <th className="text-right p-2">税抜金額</th>
                      <th className="text-right p-2">消費税</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="p-2 font-bold">8%（軽減）</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Total).toLocaleString()}</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Amount).toLocaleString()}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="p-2 font-bold">10%（標準）</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax10Total).toLocaleString()}</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax10Amount).toLocaleString()}</td>
                    </tr>
                    <tr className="bg-gray-50 font-bold">
                      <td className="p-2">合計</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Total + stats.tax10Total).toLocaleString()}</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Amount + stats.tax10Amount).toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* 管理モード */
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
                <div className="grid grid-cols-2 gap-4">
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
                    <label className="block text-sm font-bold mb-1">税率</label>
                    <select
                      value={newTaxRate}
                      onChange={(e) => setNewTaxRate(e.target.value)}
                      className="w-full p-2 border rounded"
                    >
                      <option value="8">8%（軽減税率）</option>
                      <option value="10">10%（標準税率）</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded"
                >
                  登録
                </button>
              </form>
            </div>

            {/* 登録済み商品一覧 */}
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold text-lg mb-4 border-b pb-2">登録済み商品</h2>
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left p-2">商品名</th>
                    <th className="text-right p-2">価格</th>
                    <th className="text-right p-2">税率</th>
                  </tr>
                </thead>
                <tbody>
                  {menuItems.map(item => (
                    <tr key={item.id} className="border-b">
                      <td className="p-2">{item.name}</td>
                      <td className="p-2 text-right">¥{item.price.toLocaleString()}</td>
                      <td className="p-2 text-right">{item.tax_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
