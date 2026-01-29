'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// 必要なアイコンだけインポート（lucide-reactは入っているはず）
import { ShoppingCart, Settings, Plus, Minus, Trash2, Upload, Loader2 } from 'lucide-react'

// 型定義
interface MenuItem {
  id: number
  name: string
  price: number
  category: string
  image_url?: string
  tax_rate: number
}

interface OrderItem extends MenuItem {
  quantity: number
}

export default function POSSystem() {
  const [mode, setMode] = useState<'register' | 'admin'>('register')
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)

  // 管理画面用のステート
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [taxRate, setTaxRate] = useState('10')
  const [category, setCategory] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // 商品データを取得
  const fetchMenuItems = async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .order('id', { ascending: true })

    if (error) {
      console.error('商品取得エラー:', error)
    } else {
      setMenuItems(data || [])
    }
    setIsLoading(false)
  }

  useEffect(() => {
    fetchMenuItems()
  }, [])

  // 画像選択処理
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setImageFile(file)
      const reader = new FileReader()
      reader.onloadend = () => setImagePreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  // 商品登録処理
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsUploading(true)
    setMessage(null)

    try {
      let imageUrl = null

      // 画像アップロード
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop()
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
        
        const { error: uploadError } = await supabase.storage
          .from('menu-images') // バケット名はここ！
          .upload(fileName, imageFile, { cacheControl: '3600', upsert: false })

        if (uploadError) throw new Error(`画像アップロードエラー: ${uploadError.message}`)

        const { data: urlData } = supabase.storage
          .from('menu-images')
          .getPublicUrl(fileName)
        
        imageUrl = urlData.publicUrl
      }

      // DB保存
      const { error: insertError } = await supabase
        .from('menu_items')
        .insert({
          name,
          price: parseInt(price),
          tax_rate: parseInt(taxRate),
          category: category || 'その他',
          image_url: imageUrl
        })

      if (insertError) throw new Error(`商品登録エラー: ${insertError.message}`)

      // リセット
      setName('')
      setPrice('')
      setImageFile(null)
      setImagePreview(null)
      setMessage({ type: 'success', text: '商品を登録しました！' })
      fetchMenuItems() // リスト更新

    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : '登録に失敗しました' 
      })
    } finally {
      setIsUploading(false)
    }
  }

  // レジ機能: 追加
  const addToOrder = (item: MenuItem) => {
    setOrderItems((prev) => {
      const existing = prev.find((o) => o.id === item.id)
      return existing
        ? prev.map((o) => o.id === item.id ? { ...o, quantity: o.quantity + 1 } : o)
        : [...prev, { ...item, quantity: 1 }]
    })
  }

  // レジ機能: 数量変更
  const updateQuantity = (id: number, delta: number) => {
    setOrderItems((prev) =>
      prev.map((item) => item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item)
          .filter((item) => item.quantity > 0)
    )
  }

  // レジ機能: 決済
  const checkout = async () => {
    if (orderItems.length === 0) return
    setIsProcessing(true)

    const taxDetails = orderItems.reduce((acc, item) => {
      const rate = item.tax_rate
      const amount = item.price * item.quantity
      if (!acc[rate]) acc[rate] = { subtotal: 0, tax: 0 }
      acc[rate].subtotal += amount
      acc[rate].tax += amount * (rate / 100)
      return acc
    }, {} as Record<number, { subtotal: number; tax: number }>)

    const totalAmount = orderItems.reduce((sum, item) => sum + item.price * item.quantity * (1 + item.tax_rate / 100), 0)

    const { error } = await supabase.from('sales').insert({
      items: orderItems,
      total_amount: Math.floor(totalAmount),
      tax_details: taxDetails
    })

    setIsProcessing(false)
    if (error) {
      alert('決済エラー')
    } else {
      alert('決済完了！')
      setOrderItems([])
    }
  }

  // 合計計算
  const totalAmount = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const totalTax = orderItems.reduce((sum, item) => sum + item.price * item.quantity * (item.tax_rate / 100), 0)

  if (isLoading) return <div className="p-10 text-center">読み込み中...</div>

  return (
    <div className="min-h-screen bg-gray-100 p-4 max-w-4xl mx-auto">
      {/* タブ切り替え */}
      <div className="bg-white p-2 rounded-lg shadow mb-6 flex gap-2">
        <button 
          onClick={() => setMode('register')}
          className={`flex-1 py-3 px-4 rounded-md font-bold transition-colors ${mode === 'register' ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}
        >
          <div className="flex items-center justify-center gap-2">
            <ShoppingCart size={20} /> レジモード
          </div>
        </button>
        <button 
          onClick={() => setMode('admin')}
          className={`flex-1 py-3 px-4 rounded-md font-bold transition-colors ${mode === 'admin' ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}
        >
          <div className="flex items-center justify-center gap-2">
            <Settings size={20} /> 管理モード
          </div>
        </button>
      </div>

      {mode === 'register' ? (
        <div className="flex flex-col md:flex-row gap-4 h-[80vh]">
          {/* 商品一覧 */}
          <div className="flex-1 overflow-y-auto bg-white p-4 rounded-lg shadow">
            <h2 className="font-bold text-lg mb-4">メニュー一覧</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {menuItems.map((item) => (
                <div key={item.id} onClick={() => addToOrder(item)} className="cursor-pointer border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="w-full h-32 object-cover" />
                  ) : (
                    <div className="w-full h-32 bg-gray-200 flex items-center justify-center text-gray-400">No Image</div>
                  )}
                  <div className="p-3">
                    <h3 className="font-bold">{item.name}</h3>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-green-600 font-bold">¥{item.price}</span>
                      <span className="text-xs bg-gray-100 px-1 rounded">{item.tax_rate}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {menuItems.length === 0 && <p className="text-gray-500 text-center mt-10">商品がありません。「管理モード」から登録してください。</p>}
          </div>

          {/* 注文リスト */}
          <div className="w-full md:w-80 bg-white p-4 rounded-lg shadow flex flex-col">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2"><ShoppingCart /> 現在の注文</h2>
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {orderItems.map((item) => (
                <div key={item.id} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                  <div>
                    <div className="font-bold">{item.name}</div>
                    <div className="text-sm text-gray-500">¥{item.price} x {item.quantity}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQuantity(item.id, -1)} className="p-1 bg-white border rounded"><Minus size={14}/></button>
                    <span className="w-6 text-center text-sm">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="p-1 bg-white border rounded"><Plus size={14}/></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t pt-4 space-y-2">
              <div className="flex justify-between"><span>小計</span><span>¥{totalAmount.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>消費税</span><span>¥{Math.floor(totalTax).toLocaleString()}</span></div>
              <div className="flex justify-between text-xl font-bold"><span>合計</span><span>¥{Math.floor(totalAmount + totalTax).toLocaleString()}</span></div>
              <button 
                onClick={checkout}
                disabled={orderItems.length === 0 || isProcessing}
                className="w-full bg-blue-600 text-white py-4 rounded-lg font-bold text-lg disabled:bg-gray-300 mt-2"
              >
                {isProcessing ? '処理中...' : '会計する'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* 管理モード */
        <div className="bg-white p-6 rounded-lg shadow max-w-lg mx-auto">
          <h2 className="font-bold text-xl mb-6 flex items-center gap-2"><Settings /> 商品登録</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-bold mb-1">商品名</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full p-2 border rounded" required placeholder="例: オムライス" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold mb-1">価格（税抜）</label>
                <input type="number" value={price} onChange={e => setPrice(e.target.value)} className="w-full p-2 border rounded" required placeholder="1000" />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1">税率</label>
                <select value={taxRate} onChange={e => setTaxRate(e.target.value)} className="w-full p-2 border rounded">
                  <option value="8">8% (軽減)</option>
                  <option value="10">10% (標準)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold mb-1">カテゴリ</label>
              <input value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2 border rounded" placeholder="例: 食事" />
            </div>
            <div>
              <label className="block text-sm font-bold mb-1">商品画像</label>
              <div className="border-2 border-dashed rounded-lg p-4 text-center">
                {imagePreview ? (
                  <div className="space-y-2">
                    <img src={imagePreview} className="h-32 mx-auto object-contain" />
                    <button type="button" onClick={() => {setImageFile(null); setImagePreview(null)}} className="text-red-500 text-sm underline">画像を削除</button>
                  </div>
                ) : (
                  <label className="cursor-pointer block p-4">
                    <Upload className="mx-auto text-gray-400 mb-2" />
                    <span className="text-blue-600">画像をアップロード</span>
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                  </label>
                )}
              </div>
            </div>
            
            {message && <div className={`p-3 rounded ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{message.text}</div>}
            
            <button type="submit" disabled={isUploading} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold disabled:bg-gray-400">
              {isUploading ? <span className="flex items-center justify-center gap-2"><Loader2 className="animate-spin"/> アップロード中...</span> : '登録する'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}