'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import jsPDF from 'jspdf'

interface SaleItem {
  id: number
  name: string
  price: number
  quantity: number
  tax_rate: number
}

interface Sale {
  id: number
  items: SaleItem[]
  total_amount: number
  created_at: string
  shop_id: string
}

export default function TaxReport() {
  const { shopId, shopName } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(false)

  // 月のデータを取得
  const fetchMonthlySales = async () => {
    if (!shopId) return
    setLoading(true)

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = new Date(year, month, 0)
    const endDateStr = endDate.toISOString().split('T')[0]

    const { data } = await supabase
      .from('sales')
      .select('*')
      .eq('shop_id', shopId)
      .gte('created_at', startDate)
      .lte('created_at', endDateStr)
      .order('created_at', { ascending: true })

    setSales(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchMonthlySales()
  }, [year, month, shopId])

  // 集計計算
  const calculateStats = () => {
    let tax8Subtotal = 0
    let tax8Tax = 0
    let tax10Subtotal = 0
    let tax10Tax = 0

    sales.forEach(sale => {
      if (sale.items) {
        sale.items.forEach(item => {
          const subtotal = item.price * item.quantity
          const tax = subtotal * (item.tax_rate / 100)

          if (item.tax_rate === 8) {
            tax8Subtotal += subtotal
            tax8Tax += tax
          } else {
            tax10Subtotal += subtotal
            tax10Tax += tax
          }
        })
      }
    })

    return {
      tax8Subtotal: Math.floor(tax8Subtotal),
      tax8Tax: Math.floor(tax8Tax),
      tax8Total: Math.floor(tax8Subtotal + tax8Tax),
      tax10Subtotal: Math.floor(tax10Subtotal),
      tax10Tax: Math.floor(tax10Tax),
      tax10Total: Math.floor(tax10Subtotal + tax10Tax),
      totalSubtotal: Math.floor(tax8Subtotal + tax10Subtotal),
      totalTax: Math.floor(tax8Tax + tax10Tax),
      totalAmount: Math.floor(tax8Subtotal + tax8Tax + tax10Subtotal + tax10Tax),
    }
  }

  const stats = calculateStats()

  // PDF生成
  const generatePDF = () => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })

    const pageWidth = pdf.internal.pageSize.getWidth()
    const margin = 10
    let yPosition = margin

    // タイトル
    pdf.setFontSize(16)
    pdf.text('税務申告レポート', margin, yPosition)
    yPosition += 10

    // 店舗名と期間
    pdf.setFontSize(11)
    pdf.text(`店舗: ${shopName || '未設定'}`, margin, yPosition)
    yPosition += 6
    pdf.text(`期間: ${year}年 ${month}月`, margin, yPosition)
    yPosition += 10

    // 表のヘッダ
    pdf.setFontSize(10)
    pdf.setFillColor(200, 200, 200)

    const col1 = margin
    const col2 = margin + 60
    const col3 = margin + 100
    const col4 = margin + 140

    pdf.rect(col1, yPosition, 180, 6, 'F')
    pdf.text('区分', col1 + 2, yPosition + 4)
    pdf.text('税抜売上', col2 + 2, yPosition + 4)
    pdf.text('消費税', col3 + 2, yPosition + 4)
    pdf.text('税込合計', col4 + 2, yPosition + 4)
    yPosition += 8

    // データ行
    pdf.setFontSize(9)

    // 軽減税率（8%）
    pdf.text('テイクアウト (8%)', col1 + 2, yPosition)
    pdf.text(`¥${stats.tax8Subtotal.toLocaleString()}`, col2 + 2, yPosition)
    pdf.text(`¥${stats.tax8Tax.toLocaleString()}`, col3 + 2, yPosition)
    pdf.text(`¥${stats.tax8Total.toLocaleString()}`, col4 + 2, yPosition)
    yPosition += 7

    // 標準税率（10%）
    pdf.text('店内飲食 (10%)', col1 + 2, yPosition)
    pdf.text(`¥${stats.tax10Subtotal.toLocaleString()}`, col2 + 2, yPosition)
    pdf.text(`¥${stats.tax10Tax.toLocaleString()}`, col3 + 2, yPosition)
    pdf.text(`¥${stats.tax10Total.toLocaleString()}`, col4 + 2, yPosition)
    yPosition += 8

    // 合計行
    pdf.setFillColor(220, 220, 220)
    pdf.rect(col1, yPosition - 2, 180, 6, 'F')
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'bold')
    pdf.text('合計', col1 + 2, yPosition + 2)
    pdf.text(`¥${stats.totalSubtotal.toLocaleString()}`, col2 + 2, yPosition + 2)
    pdf.text(`¥${stats.totalTax.toLocaleString()}`, col3 + 2, yPosition + 2)
    pdf.text(`¥${stats.totalAmount.toLocaleString()}`, col4 + 2, yPosition + 2)
    yPosition += 10

    // 販売記録数
    pdf.setFont(undefined, 'normal')
    pdf.setFontSize(9)
    pdf.text(`販売記録数: ${sales.length}件`, margin, yPosition)

    // 出力
    pdf.save(`税務申告_${year}年${month}月_${shopName || '店舗'}.pdf`)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">📊 税務申告レポート</h1>

        {/* 期間選択 */}
        <div className="bg-white p-4 rounded shadow mb-6">
          <h2 className="font-bold text-lg mb-4">期間を選択</h2>
          <div className="flex gap-4 items-center">
            <div>
              <label className="block text-sm font-bold mb-1">年</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="w-24 p-2 border rounded"
                min="2020"
                max="2099"
              />
            </div>
            <div>
              <label className="block text-sm font-bold mb-1">月</label>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value))}
                className="w-24 p-2 border rounded"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 集計表 */}
        <div className="bg-white p-6 rounded shadow mb-6">
          <h2 className="font-bold text-lg mb-4">{year}年 {month}月の売上集計</h2>
          
          {loading ? (
            <p>読み込み中...</p>
          ) : (
            <>
              <table className="w-full border-collapse mb-6">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border p-3 text-left">区分</th>
                    <th className="border p-3 text-right">税抜売上</th>
                    <th className="border p-3 text-right">消費税</th>
                    <th className="border p-3 text-right">税込合計</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border p-3 font-bold">🥡 テイクアウト (8%)</td>
                    <td className="border p-3 text-right">¥{stats.tax8Subtotal.toLocaleString()}</td>
                    <td className="border p-3 text-right">¥{stats.tax8Tax.toLocaleString()}</td>
                    <td className="border p-3 text-right font-bold">¥{stats.tax8Total.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td className="border p-3 font-bold">🍽️ 店内飲食 (10%)</td>
                    <td className="border p-3 text-right">¥{stats.tax10Subtotal.toLocaleString()}</td>
                    <td className="border p-3 text-right">¥{stats.tax10Tax.toLocaleString()}</td>
                    <td className="border p-3 text-right font-bold">¥{stats.tax10Total.toLocaleString()}</td>
                  </tr>
                  <tr className="bg-gray-50 font-bold">
                    <td className="border p-3">合計</td>
                    <td className="border p-3 text-right">¥{stats.totalSubtotal.toLocaleString()}</td>
                    <td className="border p-3 text-right">¥{stats.totalTax.toLocaleString()}</td>
                    <td className="border p-3 text-right">¥{stats.totalAmount.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>

              <p className="text-gray-600 text-sm mb-4">
                販売記録数: <span className="font-bold">{sales.length}件</span>
              </p>

              <button
                onClick={generatePDF}
                className="px-6 py-3 bg-green-600 text-white font-bold rounded hover:bg-green-700"
              >
                📥 PDFをダウンロード
              </button>
            </>
          )}
        </div>

        {/* 詳細レコード */}
        <div className="bg-white p-6 rounded shadow">
          <h2 className="font-bold text-lg mb-4">詳細レコード</h2>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="border p-2 text-left">日時</th>
                  <th className="border p-2 text-center">区分</th>
                  <th className="border p-2 text-left">商品</th>
                  <th className="border p-2 text-right">金額</th>
                </tr>
              </thead>
              <tbody>
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="border p-4 text-center text-gray-400">
                      この期間に売上はありません
                    </td>
                  </tr>
                ) : (
                  sales.map(sale => {
                    const taxRate = sale.items?.[0]?.tax_rate
                    const isTakeout = taxRate === 8
                    const saleDate = new Date(sale.created_at).toLocaleString('ja-JP')
                    return (
                      <tr key={sale.id} className="hover:bg-gray-50">
                        <td className="border p-2 text-gray-600">{saleDate}</td>
                        <td className="border p-2 text-center text-lg">
                          {isTakeout ? '🥡' : '🍽️'}
                        </td>
                        <td className="border p-2">
                          {sale.items?.map((item, i) => (
                            <span key={i}>
                              {item.name}
                              {i < sale.items!.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </td>
                        <td className="border p-2 text-right font-bold">
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
  )
}
