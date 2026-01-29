'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, ShoppingCart } from 'lucide-react'

type MenuItem = Database['public']['Tables']['menu_items']['Row']
type OrderItem = {
  menu_item_id: number
  name: string
  price: number
  quantity: number
}

export default function POSSystem() {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    fetchMenuItems()
  }, [])

  const fetchMenuItems = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .order('category', { ascending: true })

      if (error) throw error
      setMenuItems(data || [])
    } catch (error) {
      console.error('メニューの取得エラー:', error)
      alert('メニューの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const addToOrder = (item: MenuItem) => {
    setOrderItems((prev) => {
      const existingItem = prev.find((oi) => oi.menu_item_id === item.id)
      
      if (existingItem) {
        return prev.map((oi) =>
          oi.menu_item_id === item.id
            ? { ...oi, quantity: oi.quantity + 1 }
            : oi
        )
      }
      
      return [
        ...prev,
        {
          menu_item_id: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
        },
      ]
    })
  }

  const removeFromOrder = (menuItemId: number) => {
    setOrderItems((prev) => prev.filter((item) => item.menu_item_id !== menuItemId))
  }

  const updateQuantity = (menuItemId: number, delta: number) => {
    setOrderItems((prev) =>
      prev
        .map((item) =>
          item.menu_item_id === menuItemId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    )
  }

  const calculateTotal = () => {
    return orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  }

  const handleCheckout = async () => {
    if (orderItems.length === 0) {
      alert('注文が空です')
      return
    }

    try {
      setProcessing(true)
      const total = calculateTotal()

      const { error } = await supabase.from('sales').insert({
        items: orderItems,
        total_amount: total,
      })

      if (error) throw error

      alert(`決済完了！合計: ¥${total.toLocaleString()}`)
      setOrderItems([])
    } catch (error) {
      console.error('決済エラー:', error)
      alert('決済に失敗しました')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* 左側: メニュー一覧 */}
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-3xl font-bold mb-6">メニュー</h1>
        <div className="grid grid-cols-3 gap-4">
          {menuItems.map((item) => (
            <Card
              key={item.id}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => addToOrder(item)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{item.name}</CardTitle>
              </CardHeader>
              <CardContent>
                {item.description && (
                  <p className="text-sm text-gray-600 mb-2">{item.description}</p>
                )}
                <p className="text-xl font-bold text-primary">
                  ¥{item.price.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500 mt-1">{item.category}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* 右側: 現在の注文リスト */}
      <div className="w-96 bg-white shadow-xl p-6 flex flex-col">
        <div className="flex items-center gap-2 mb-6">
          <ShoppingCart className="w-6 h-6" />
          <h2 className="text-2xl font-bold">現在の注文</h2>
        </div>

        <div className="flex-1 overflow-y-auto mb-4">
          {orderItems.length === 0 ? (
            <p className="text-gray-500 text-center py-8">注文がありません</p>
          ) : (
            <div className="space-y-3">
              {orderItems.map((item) => (
                <Card key={item.menu_item_id}>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <p className="font-semibold">{item.name}</p>
                        <p className="text-sm text-gray-600">
                          ¥{item.price.toLocaleString()} × {item.quantity}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFromOrder(item.menu_item_id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateQuantity(item.menu_item_id, -1)}
                      >
                        -
                      </Button>
                      <span className="w-8 text-center font-semibold">
                        {item.quantity}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateQuantity(item.menu_item_id, 1)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <span className="ml-auto font-bold">
                        ¥{(item.price * item.quantity).toLocaleString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="border-t pt-4 space-y-4">
          <div className="flex justify-between items-center text-xl font-bold">
            <span>合計:</span>
            <span>¥{calculateTotal().toLocaleString()}</span>
          </div>
          <Button
            className="w-full h-14 text-lg"
            onClick={handleCheckout}
            disabled={orderItems.length === 0 || processing}
          >
            {processing ? '処理中...' : '決済'}
          </Button>
        </div>
      </div>
    </div>
  )
}
