export interface OcrExtractedExpense {
  expense_date: string
  amount: number
  description: string
  merchant?: string
  confidence?: number
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function toYmd(input: unknown): string | null {
  const text = String(input ?? '').trim()
  if (!text) return null
  const normalized = text.replace(/[./年]/g, '-').replace(/月/g, '-').replace(/日/g, '')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function sanitizeAmount(input: unknown): number | null {
  const raw = String(input ?? '').replace(/[¥￥,\s]/g, '')
  const num = Number(raw)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.floor(num)
}

function sanitizeDescription(input: unknown, merchant?: string): string {
  const text = String(input ?? '').trim()
  if (text) return text.slice(0, 120)
  const m = String(merchant ?? '').trim()
  if (m) return `${m} レシート`
  return 'レシート取込'
}

function dataUrlToParts(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

export async function extractExpenseByGeminiOcr(dataUrl: string): Promise<OcrExtractedExpense> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('gemini api key missing')

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite'
  const image = dataUrlToParts(dataUrl)
  if (!image) throw new Error('invalid imageDataUrl')

  const prompt = [
    'あなたは日本語レシートOCRアシスタントです。',
    '画像から経費入力に必要な最小情報を抽出してください。',
    '返答はJSONのみ。',
    'スキーマ:',
    '{"expense_date":"YYYY-MM-DD","amount":1234,"description":"内容","merchant":"店名","confidence":0-100}',
    'ルール:',
    '- 金額は税込合計額を優先',
    '- 日付が不明なら今日の日付',
    '- 説明は短く',
  ].join('\n')

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.base64,
                },
              },
            ],
          },
        ],
      }),
    }
  )

  if (!response.ok) throw new Error(`gemini failed: ${response.status}`)

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const parsed = parseJsonObject(text)
  if (!parsed) throw new Error('gemini returned non-json')

  const merchant = String(parsed.merchant ?? '').trim() || undefined
  const expenseDate = toYmd(parsed.expense_date) ?? new Date().toISOString().slice(0, 10)
  const amount = sanitizeAmount(parsed.amount)
  if (!amount) throw new Error('could not parse amount from receipt')

  return {
    expense_date: expenseDate,
    amount,
    merchant,
    description: sanitizeDescription(parsed.description, merchant),
    confidence: Number(parsed.confidence ?? 0),
  }
}
