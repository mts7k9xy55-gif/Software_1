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

interface TaxSummary {
  rate: number
  subtotal: number
  tax: number
  total: number
}

export default function POSSystemSimple() {
  // 基本ステート
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [salesData, setSalesData] = useState<SaleRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)

  // 入力フォーム用
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [quantity, setQuantity] = useState<number>(1)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 管理画面用
  const [mode, setMode] = useState<'pos' | 'admin'>('pos')
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newTaxRate, setNewTaxRate] = useState('10')

  // 初期データ取得
  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setIsLoading(true)
    
    // 商品取得
    const { data: items } = await supabase
      .from('menu_items')
      .select('id, name, price, tax_rate')
      .order('name')
    
    // 本日の売上取得
    const today = new Date().toISOString().split('T')[0]
    const { data: sales } = await supabase
      .from('sales')
      .select('*')
      .gte('created_at', today)
      .order('created_at', { ascending: false })

    setMenuItems(items || [])
    setSalesData(sales || [])
    setIsLoading(false)
  }

  // 売上登録
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItemId || quantity < 1) return

    setIsProcessing(true)
    setMessage(null)

    const item = menuItems.find(m => m.id === parseInt(selectedItemId))
    if (!item) {
      setMessage({ type: 'error', text: '商品が見つかりません' })
      setIsProcessing(false)
      return
    }

    const subtotal = item.price * quantity
    const tax = Math.floor(subtotal * (item.tax_rate / 100))
    const total = subtotal + tax

    const saleData = {
      items: [{
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: quantity,
        tax_rate: item.tax_rate
      }],
      total_amount: total,
      tax_details: {
        [item.tax_rate]: { subtotal, tax }
      }
    }

    const { error } = await supabase.from('sales').insert(saleData)

    if (error) {
      setMessage({ type: 'error', text: '登録失敗: ' + error.message })
    } else {
      setMessage({ type: 'success', text: `¥${total.toLocaleString()} を登録しました` })
      setSelectedItemId('')
      setQuantity(1)
      fetchData() // 再取得
    }

    setIsProcessing(false)
  }

  // 商品登録
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName || !newPrice) return

    const { error } = await supabase.from('menu_items').insert({
      name: newName,
      price: parseInt(newPrice),
      tax_rate: parseInt(newTaxRate),
      category: 'その他'
    })

    if (error) {
      alert('登録失敗: ' + error.message)
    } else {
      alert('商品を登録しました')
      setNewName('')
      setNewPrice('')
      fetchData()
    }
  }

  // 今日の合計計算
  const getTodayTotal = () => {
    return salesData.reduce((sum, sale) => sum + sale.total_amount, 0)
  }

  // 税率別集計
  const getTaxSummary = (): TaxSummary[] => {
    const taxMap = new Map<number, { subtotal: number; tax: number }>()

    salesData.forEach(sale => {
      if (sale.items && Array.isArray(sale.items)) {
        sale.items.forEach(item => {
          const rate = item.tax_rate || 10
          const subtotal = item.price * item.quantity
          const tax = Math.floor(subtotal * (rate / 100))
          
          const existing = taxMap.get(rate) || { subtotal: 0, tax: 0 }
          existing.subtotal += subtotal
          existing.tax += tax
          taxMap.set(rate, existing)
        })
      }
    })

    return Array.from(taxMap.entries()).map(([rate, data]) => ({
      rate,
      subtotal: data.subtotal,
      tax: data.tax,
      total: data.subtotal + data.tax
    })).sort((a, b) => a.rate - b.rate)
  }

  // 時刻フォーマット
  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }

  if (isLoading) {
    return <div className="p-10 text-center text-gray-500">読み込み中...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">売上管理システム</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('pos')}
              className={`px-4 py-2 rounded font-bold ${mode === 'pos' ? 'bg-blue-600 text-white' : 'bg-white border'}`}
            >
              レジ
            </button>
            <button
              onClick={() => setMode('admin')}
              className={`px-4 py-2 rounded font-bold ${mode === 'admin' ? 'bg-blue-600 text-white' : 'bg-white border'}`}
            >
              管理
            </button>
          </div>
        </div>

        {mode === 'pos' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* 左: 入力フォーム */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-lg font-bold mb-4 border-b pb-2">売上入力</h2>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold mb-1">商品</label>
                  <select
                    value={selectedItemId}
                    onChange={(e) => setSelectedItemId(e.target.value)}
                    className="w-full p-3 border rounded text-lg"
                    required
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

                {/* 金額プレビュー */}
                {selectedItemId && (
                  <div className="bg-gray-100 p-4 rounded">
                    {(() => {
                      const item = menuItems.find(m => m.id === parseInt(selectedItemId))
                      if (!item) return null
                      const subtotal = item.price * quantity
                      const tax = Math.floor(subtotal * (item.tax_rate / 100))
                      return (
                        <>
                          <div className="flex justify-between text-sm">
                            <span>小計</span>
                            <span>¥{subtotal.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span>消費税({item.tax_rate}%)</span>
                            <span>¥{tax.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between font-bold text-xl mt-2 pt-2 border-t">
                            <span>合計</span>
                            <span>¥{(subtotal + tax).toLocaleString()}</span>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isProcessing || !selectedItemId}
                  className="w-full py-4 bg-blue-600 text-white font-bold text-lg rounded disabled:bg-gray-300"
                >
                  {isProcessing ? '処理中...' : '売上登録'}
                </button>

                {message && (
                  <div className={`p-3 rounded text-center ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {message.text}
                  </div>
                )}
              </form>

              <button
                onClick={fetchData}
                className="w-full mt-4 py-2 border rounded text-gray-600 hover:bg-gray-50"
              >
                ↻ データ更新
              </button>
            </div>

            {/* 中央: 本日の売上明細 */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-lg font-bold mb-4 border-b pb-2">
                本日の売上明細
                <span className="text-sm font-normal text-gray-500 ml-2">({salesData.length}件)</span>
              </h2>
              
              <div className="overflow-y-auto max-h-96">
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
                        <td colSpan={3} className="p-4 text-center text-gray-400">本日の売上はありません</td>
                      </tr>
                    ) : (
                      salesData.map(sale => (
                        <tr key={sale.id} className="border-b hover:bg-gray-50">
                          <td className="p-2 text-gray-600">{formatTime(sale.created_at)}</td>
                          <td className="p-2">
                            {sale.items?.map((item, i) => (
                              <div key={i}>{item.name} ×{item.quantity}</div>
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

            {/* 右: 集計 */}
            <div className="space-y-6">
              {/* 本日合計 */}
              <div className="bg-blue-600 text-white p-6 rounded-lg shadow">
                <h2 className="text-sm opacity-80">本日の売上合計</h2>
                <p className="text-4xl font-bold mt-2">¥{getTodayTotal().toLocaleString()}</p>
                <p className="text-sm opacity-80 mt-1">{salesData.length}件の取引</p>
              </div>

              {/* 税率別集計 */}
              <div className="bg-white p-6 rounded-lg shadow">
                <h2 className="text-lg font-bold mb-4 border-b pb-2">税率別集計</h2>
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2">税率</th>
                      <th className="text-right p-2">税抜</th>
                      <th className="text-right p-2">消費税</th>
                      <th className="text-right p-2">税込</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getTaxSummary().length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-gray-400">データなし</td>
                      </tr>
                    ) : (
                      getTaxSummary().map(row => (
                        <tr key={row.rate} className="border-b">
                          <td className="p-2 font-bold">{row.rate}%</td>
                          <td className="p-2 text-right">¥{row.subtotal.toLocaleString()}</td>
                          <td className="p-2 text-right">¥{row.tax.toLocaleString()}</td>
                          <td className="p-2 text-right font-bold">¥{row.total.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot className="bg-gray-100 font-bold">
                    <tr>
                      <td className="p-2">合計</td>
                      <td className="p-2 text-right">
                        ¥{getTaxSummary().reduce((s, r) => s + r.subtotal, 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right">
                        ¥{getTaxSummary().reduce((s, r) => s + r.tax, 0).toLocaleString()}
                      </td>
                      <td className="p-2 text-right">
                        ¥{getTaxSummary().reduce((s, r) => s + r.total, 0).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* 管理モード */
          <div className="max-w-lg mx-auto bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-bold mb-4 border-b pb-2">商品登録</h2>
            <form onSubmit={handleAddItem} className="space-y-4">
              <div>
                <label className="block text-sm font-bold mb-1">商品名</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full p-3 border rounded"
                  placeholder="例: カフェラテ"
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
                    className="w-full p-3 border rounded"
                    placeholder="500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">税率</label>
                  <select
                    value={newTaxRate}
                    onChange={(e) => setNewTaxRate(e.target.value)}
                    className="w-full p-3 border rounded"
                  >
                    <option value="8">8% (軽減)</option>
                    <option value="10">10% (標準)</option>
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-green-600 text-white font-bold rounded"
              >
                商品を登録
              </button>
            </form>

            {/* 登録済み商品一覧 */}
            <div className="mt-8">
              <h3 className="font-bold mb-2">登録済み商品 ({menuItems.length}件)</h3>
              <div className="max-h-64 overflow-y-auto border rounded">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
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
                        <td className="p-2 text-right">¥{item.price}</td>
                        <td className="p-2 text-right">{item.tax_rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
