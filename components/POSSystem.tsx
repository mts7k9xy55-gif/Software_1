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

  // 商品クリックで即座に売上記録
  const recordSale = async (item: MenuItem, qty: number = 1) => {
    const subtotal = item.price * qty
    const tax = subtotal * (item.tax_rate / 100)
    const total = subtotal + tax

    const saleData = {
      items: [{
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: qty,
        tax_rate: item.tax_rate
      }],
      total_amount: Math.floor(total),
      tax_details: {
        [item.tax_rate]: { subtotal, tax }
      }
    }

    const { error } = await supabase.from('sales').insert(saleData)
    
    if (error) {
      alert('記録エラー: ' + error.message)
    } else {
      // 即座に履歴を更新
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
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-bold">売上記録システム</h1>
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
          </div>
        </div>

        {mode === 'register' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 左: 商品ボタン（クリックで即記録） */}
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold text-lg mb-4 border-b pb-2">
                商品をタップして売上を記録
              </h2>
              
              {menuItems.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  商品がありません。「商品管理」から登録してください。
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {menuItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => recordSale(item, 1)}
                      className="p-4 border-2 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition-colors text-left"
                    >
                      <div className="font-bold text-lg">{item.name}</div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-green-600 font-bold">
                          ¥{Math.floor(item.price * (1 + item.tax_rate / 100)).toLocaleString()}
                        </span>
                        <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                          {item.tax_rate}%
                        </span>
                      </div>
                    </button>
                  ))}
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
                      <th className="text-left p-2">税率</th>
                      <th className="text-right p-2">税抜</th>
                      <th className="text-right p-2">消費税</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="p-2">8%（軽減）</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Total).toLocaleString()}</td>
                      <td className="p-2 text-right">¥{Math.floor(stats.tax8Amount).toLocaleString()}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="p-2">10%（標準）</td>
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

              {/* 売上履歴（帳簿） */}
              <div className="bg-white p-4 rounded shadow">
                <div className="flex justify-between items-center mb-3 border-b pb-2">
                  <h3 className="font-bold">今日の売上履歴（帳簿）</h3>
                  <button onClick={fetchTodaySales} className="text-blue-600 text-sm hover:underline">
                    更新
                  </button>
                </div>
                
                <div className="overflow-y-auto max-h-64">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">時刻</th>
                        <th className="text-left p-2">商品</th>
                        <th className="text-right p-2">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesData.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-4 text-center text-gray-400">
                            まだ記録がありません
                          </td>
                        </tr>
                      ) : (
                        salesData.map(sale => (
                          <tr key={sale.id} className="border-b hover:bg-gray-50">
                            <td className="p-2 text-gray-600">{formatTime(sale.created_at)}</td>
                            <td className="p-2">
                              {sale.items?.map((item, i) => (
                                <span key={i}>
                                  {item.name}
                                  {item.quantity > 1 && `×${item.quantity}`}
                                  {i < sale.items.length - 1 ? ', ' : ''}
                                </span>
                              ))}
                            </td>
                            <td className="p-2 text-right font-bold">
                              ¥{sale.total_amount.toLocaleString()}
                            </td>
                          </tr>
                        ))
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
                  商品を登録
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
                    <th className="text-right p-2">税抜価格</th>
                    <th className="text-right p-2">税込価格</th>
                    <th className="text-right p-2">税率</th>
                  </tr>
                </thead>
                <tbody>
                  {menuItems.map(item => (
                    <tr key={item.id} className="border-b">
                      <td className="p-2">{item.name}</td>
                      <td className="p-2 text-right">¥{item.price.toLocaleString()}</td>
                      <td className="p-2 text-right font-bold">
                        ¥{Math.floor(item.price * (1 + item.tax_rate / 100)).toLocaleString()}
                      </td>
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
