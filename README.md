# POS System

POSシステム - Supabase + Next.js + Shadcn/ui

## セットアップ

1. 依存関係をインストール:
```bash
npm install
```

2. `.env.local`にSupabase認証情報を追加:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. Supabaseテーブルを作成:

### menu_items テーブル
```sql
CREATE TABLE menu_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### sales テーブル
```sql
CREATE TABLE sales (
  id SERIAL PRIMARY KEY,
  items JSONB NOT NULL,
  total_amount NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

4. サンプルデータを追加:
```sql
INSERT INTO menu_items (name, price, category, description) VALUES
  ('コーヒー', 400, '飲み物', '香り高いコーヒー'),
  ('紅茶', 350, '飲み物', 'フレッシュな紅茶'),
  ('サンドイッチ', 650, '食べ物', '新鮮な野菜のサンドイッチ'),
  ('ケーキ', 500, 'デザート', '手作りケーキ');
```

5. 開発サーバーを起動:
```bash
npm run dev
```

## 機能

- ✅ Supabaseのmenu_itemsテーブルから全商品を取得
- ✅ Gridレイアウト（3カラム）で商品を表示
- ✅ カードクリックで注文リストに追加
- ✅ 数量の増減機能
- ✅ 注文の削除機能
- ✅ 決済ボタンでsalesテーブルにデータを保存
- ✅ Shadcn/uiのコンポーネントを使用
