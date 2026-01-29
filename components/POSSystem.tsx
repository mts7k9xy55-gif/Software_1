'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

// レジモードコンポーネント
function RegisterMode({ 
  menuItems, 
  orderItems, 
  onAddItem, 
  onUpdateQuantity, 
  onRemoveItem, 
  onCheckout,
  isProcessing 
}: {
  menuItems: MenuItem[]
  orderItems: OrderItem[]
  onAddItem: (item: MenuItem) => void
  onUpdateQuantity: (id: number, delta: number) => void
  onRemoveItem: (id: number) => void
  onCheckout: () => void
  isProcessing: boolean
}) {
  const totalAmount = orderItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )

  const totalTax = orderItems.reduce(
    (sum, item) => sum + item.price * item.quantity * (item.tax_rate / 100),
    0
  )

  return (
    <div className="flex gap-6 h-full">
      {/* 左側: 商品グリッド */}
      <div className="flex-1">
        <h2 className="text-xl font-bold mb-4">商品一覧</h2>
        <div className="grid grid-cols-3 gap-4">
          {menuItems.map((item) => (
            <Card
              key={item.id}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => onAddItem(item)}
            >
              <CardContent className="p-4">
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="w-full h-32 object-cover rounded-md mb-2"
                  />
                )}
                <h3 className="font-semibold text-lg">{item.name}</h3>
                <div className="flex justify-between items-center mt-2">
                  <p className="text-xl font-bold text-green-600">
                    ¥{item.price.toLocaleString()}
                  </p>
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                    {item.tax_rate}%
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* 右側: 注文リスト */}
      <div className="w-96">
        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              現在の注文
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <div className="flex-1 overflow-auto space-y-3">
              {orderItems.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  商品をクリックして追加
                </p>
              ) : (
                orderItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-gray-600">
                        ¥{item.price.toLocaleString()} × {item.quantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => onUpdateQuantity(item.id, -1)}
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                      <span className="w-8 text-center">{item.quantity}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => onUpdateQuantity(item.id, 1)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="destructive"
                        onClick={() => onRemoveItem(item.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 合計・決済 */}
            <div className="border-t pt-4 mt-4 space-y-3">
              <div className="flex justify-between text-sm text-gray-600">
                <span>小計</span>
                <span>¥{(totalAmount).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600">
                <span>消費税</span>
                <span>¥{Math.floor(totalTax).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xl font-bold">
                <span>合計（税込）</span>
                <span>¥{Math.floor(totalAmount + totalTax).toLocaleString()}</span>
              </div>
              <Button
                className="w-full h-14 text-lg"
                disabled={orderItems.length === 0 || isProcessing}
                onClick={onCheckout}
              >
                {isProcessing ? (
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                ) : null}
                決済する
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// 管理モードコンポーネント
function AdminMode({ onItemAdded }: { onItemAdded: () => void }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [taxRate, setTaxRate] = useState('10')
  const [category, setCategory] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setImageFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsUploading(true)
    setMessage(null)

    try {
      let imageUrl = null

      // 画像をSupabase Storageにアップロード
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop()
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('menu-images')
          .upload(fileName, imageFile, {
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          throw new Error(`画像アップロードエラー: ${uploadError.message}`)
        }

        // 公開URLを取得
        const { data: urlData } = supabase.storage
          .from('menu-images')
          .getPublicUrl(fileName)
        
        imageUrl = urlData.publicUrl
      }

      // menu_itemsテーブルに保存
      const { error: insertError } = await supabase
        .from('menu_items')
        .insert({
          name,
          price: parseInt(price),
          tax_rate: parseInt(taxRate),
          category: category || 'その他',
          image_url: imageUrl
        })

      if (insertError) {
        throw new Error(`商品登録エラー: ${insertError.message}`)
      }

      // フォームをリセット
      setName('')
      setPrice('')
      setTaxRate('10')
      setCategory('')
      setImageFile(null)
      setImagePreview(null)
      setMessage({ type: 'success', text: '商品を登録しました！' })
      
      // 親コンポーネントに通知
      onItemAdded()

    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : '登録に失敗しました' 
      })
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            商品登録
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 商品名 */}
            <div className="space-y-2">
              <Label htmlFor="name">商品名 *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: カフェラテ"
                required
              />
            </div>

            {/* 価格 */}
            <div className="space-y-2">
              <Label htmlFor="price">価格（税抜） *</Label>
              <Input
                id="price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="例: 500"
                min="0"
                required
              />
            </div>

            {/* 税率 */}
            <div className="space-y-2">
              <Label htmlFor="taxRate">税率 *</Label>
              <Select value={taxRate} onValueChange={setTaxRate}>
                <SelectTrigger>
                  <SelectValue placeholder="税率を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">8%（軽減税率）</SelectItem>
                  <SelectItem value="10">10%（標準税率）</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* カテゴリ */}
            <div className="space-y-2">
              <Label htmlFor="category">カテゴリ</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="例: ドリンク"
              />
            </div>

            {/* 画像アップロード */}
            <div className="space-y-2">
              <Label htmlFor="image">商品画像</Label>
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                {imagePreview ? (
                  <div className="space-y-4">
                    <img
                      src={imagePreview}
                      alt="プレビュー"
                      className="max-h-48 mx-auto rounded-lg"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setImageFile(null)
                        setImagePreview(null)
                      }}
                    >
                      画像を削除
                    </Button>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <Upload className="w-10 h-10 mx-auto text-gray-400 mb-2" />
                    <p className="text-gray-600">クリックして画像を選択</p>
                    <p className="text-sm text-gray-400">PNG, JPG, GIF対応</p>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* メッセージ */}
            {message && (
              <div
                className={`p-4 rounded-lg ${
                  message.type === 'success'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {message.text}
              </div>
            )}

            {/* 登録ボタン */}
            <Button
              type="submit"
              className="w-full h-12 text-lg"
              disabled={isUploading || !name || !price}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  登録中...
                </>
              ) : (
                '商品を登録'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// メインコンポーネント
export default function POSSystem() {
  const [mode, setMode] = useState<'register' | 'admin'>('register')
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)

  // 商品データを取得
  const fetchMenuItems = async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .order('id', { ascending: true })

    if (error) {
      console.error('商品取得エラー:', error)
      return
    }

    setMenuItems(data || [])
    setIsLoading(false)
  }

  useEffect(() => {
    fetchMenuItems()
  }, [])

  // 商品を注文に追加
  const addToOrder = (item: MenuItem) => {
    setOrderItems((prev) => {
      const existing = prev.find((o) => o.id === item.id)
      if (existing) {
        return prev.map((o) =>
          o.id === item.id ? { ...o, quantity: o.quantity + 1 } : o
        )
      }
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  // 数量を更新
  const updateQuantity = (id: number, delta: number) => {
    setOrderItems((prev) =>
      prev
        .map((item) =>
          item.id === id
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    )
  }

  // 商品を削除
  const removeItem = (id: number) => {
    setOrderItems((prev) => prev.filter((item) => item.id !== id))
  }

  // 決済処理
  const checkout = async () => {
    if (orderItems.length === 0) return

    setIsProcessing(true)

    const taxDetails = orderItems.reduce((acc, item) => {
      const rate = item.tax_rate
      const amount = item.price * item.quantity
      const tax = amount * (rate / 100)
      
      if (!acc[rate]) {
        acc[rate] = { subtotal: 0, tax: 0 }
      }
      acc[rate].subtotal += amount
      acc[rate].tax += tax
      
      return acc
    }, {} as Record<number, { subtotal: number; tax: number }>)

    const totalAmount = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity * (1 + item.tax_rate / 100),
      0
    )

    const { error } = await supabase.from('sales').insert({
      items: orderItems.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        tax_rate: item.tax_rate
      })),
      total_amount: Math.floor(totalAmount),
      tax_details: taxDetails
    })

    setIsProcessing(false)

    if (error) {
      console.error('決済エラー:', error)
      alert('決済に失敗しました')
      return
    }

    alert('決済が完了しました！')
    setOrderItems([])
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* ヘッダー: モード切り替え */}
      <div className="mb-6">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'register' | 'admin')}>
          <TabsList className="grid w-64 grid-cols-2">
            <TabsTrigger value="register" className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              レジ
            </TabsTrigger>
            <TabsTrigger value="admin" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              管理
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* コンテンツ */}
      {mode === 'register' ? (
        <RegisterMode
          menuItems={menuItems}
          orderItems={orderItems}
          onAddItem={addToOrder}
          onUpdateQuantity={updateQuantity}
          onRemoveItem={removeItem}
          onCheckout={checkout}
          isProcessing={isProcessing}
        />
      ) : (
        <AdminMode onItemAdded={fetchMenuItems} />
      )}
    </div>
  )
}