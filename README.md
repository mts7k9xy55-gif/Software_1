# POS System

POSシステム - Supabase + Next.js + Shadcn/ui

## セットアップ

1. 依存関係をインストール:
```bash
npm install
```

2. `.env.local`に環境変数を追加:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-20b
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash-lite
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
ENABLE_OLLAMA=1
```

3. Clerkダッシュボードで認証方式（メール、Google等）を有効化

4. Supabaseテーブルを作成:

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

5. サンプルデータを追加:
```sql
INSERT INTO menu_items (name, price, category, description) VALUES
  ('コーヒー', 400, '飲み物', '香り高いコーヒー'),
  ('紅茶', 350, '飲み物', 'フレッシュな紅茶'),
  ('サンドイッチ', 650, '食べ物', '新鮮な野菜のサンドイッチ'),
  ('ケーキ', 500, 'デザート', '手作りケーキ');
```

6. 開発サーバーを起動:
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
- ✅ 税務モードのワンタップ申告パック出力（CSV/JSON/README）
- ✅ 申告準備度チェック（BLOCKER/REVIEW/READY）と税理士向け引き継ぎメモ
- ✅ 既存データの初回取込（売上CSV/経費CSV）
- ✅ レシート画像OCR（Gemini）から経費フォームの自動入力

## 設計ドキュメント

- `docs/DESIGN_EXECUTION_PLAN_2026-02.md`: 設計を実装に落とすための運用計画
- `docs/TAX_PACK_SPEC.md`: 申告パックの出力仕様とブロッキングポリシー

## PWA

- Manifest: `/public/manifest.json`
- Service Worker: `/public/sw.js`
- Offline fallback: `/public/offline.html`
- Icons: `/public/icon-192.png`, `/public/icon-512.png`, `/public/apple-touch-icon.png`
