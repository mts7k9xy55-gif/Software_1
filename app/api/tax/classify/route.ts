import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { classifyExpenses, type ClassifiedExpense, type ExpenseInput } from '@/lib/taxAutopilot'

type ProviderName = 'ollama' | 'groq' | 'gemini'

interface LlmJudgement {
  rank: 'OK' | 'REVIEW' | 'NG'
  confidence: number
  reason: string
  accountItem: string
  taxCategory: '課税仕入' | '不課税/対象外'
  businessRatio: number
}

interface ProviderResult {
  judgement: LlmJudgement
  provider: ProviderName
  model: string
}

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num))
}

function sanitizeJudgement(input: Partial<LlmJudgement>): LlmJudgement {
  const rank = input.rank === 'OK' || input.rank === 'NG' ? input.rank : 'REVIEW'
  const confidence = clamp(Math.round(Number(input.confidence ?? 50)), 0, 100)
  const accountItem = String(input.accountItem ?? '雑費')
  const reason = String(input.reason ?? '追加確認が必要です。').slice(0, 240)
  const taxCategory = input.taxCategory === '不課税/対象外' ? '不課税/対象外' : '課税仕入'
  const businessRatio = clamp(Math.round(Number(input.businessRatio ?? 100)), 0, 100)

  return {
    rank,
    confidence,
    reason,
    accountItem,
    taxCategory,
    businessRatio,
  }
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

function redactSensitiveText(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{2,4}-\d{2,4}-\d{3,4}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{12,19}\b/g, '[REDACTED_NUMBER]')
    .replace(/[0-9]{2,4}[-/][0-9]{1,2}[-/][0-9]{1,2}/g, '[REDACTED_DATE_IN_TEXT]')
}

function sanitizeExpenseForLlm(expense: ExpenseInput): ExpenseInput {
  return {
    ...expense,
    description: redactSensitiveText(expense.description).slice(0, 160),
  }
}

function buildPrompt(expense: ExpenseInput): string {
  return [
    'あなたは日本の個人事業の税務補助AIです。',
    '返答はJSONのみ。余計な文字は禁止。',
    '目的: 経費候補を保守的に判定する。',
    '出力JSONスキーマ:',
    '{"rank":"OK|REVIEW|NG","confidence":0-100,"reason":"100文字以内","accountItem":"勘定科目","taxCategory":"課税仕入|不課税/対象外","businessRatio":0-100}',
    'ルール:',
    '- 根拠が弱い場合は必ずREVIEW',
    '- 私用疑いはNG',
    '- 金額が高額な場合はREVIEW寄り',
    '- 断定せず保守的に',
    '入力:',
    JSON.stringify({
      expense_date: expense.expense_date,
      amount: expense.amount,
      description: expense.description,
      has_receipt: Boolean(expense.receipt_url),
    }),
  ].join('\n')
}

async function callOllama(expense: ExpenseInput): Promise<ProviderResult> {
  const model = process.env.OLLAMA_MODEL ?? 'qwen3:8b'
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: buildPrompt(expense),
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`ollama failed: ${response.status}`)
  }

  const payload = (await response.json()) as { response?: string }
  const parsed = parseJsonObject(String(payload.response ?? ''))
  if (!parsed) throw new Error('ollama returned non-json')

  return {
    provider: 'ollama',
    model,
    judgement: sanitizeJudgement(parsed as Partial<LlmJudgement>),
  }
}

async function callGroq(expense: ExpenseInput): Promise<ProviderResult> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('groq api key missing')

  const model = process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b'
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'You are a conservative Japanese tax assistant. Return strict JSON only with keys rank, confidence, reason, accountItem, taxCategory, businessRatio.',
        },
        {
          role: 'user',
          content: buildPrompt(expense),
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`groq failed: ${response.status}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content ?? ''
  const parsed = parseJsonObject(content)
  if (!parsed) throw new Error('groq returned non-json')

  return {
    provider: 'groq',
    model,
    judgement: sanitizeJudgement(parsed as Partial<LlmJudgement>),
  }
}

async function callGemini(expense: ExpenseInput): Promise<ProviderResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('gemini api key missing')

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite'
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(expense) }],
          },
        ],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`gemini failed: ${response.status}`)
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const parsed = parseJsonObject(text)
  if (!parsed) throw new Error('gemini returned non-json')

  return {
    provider: 'gemini',
    model,
    judgement: sanitizeJudgement(parsed as Partial<LlmJudgement>),
  }
}

async function escalateReview(expense: ExpenseInput): Promise<ProviderResult | null> {
  const hasOllama = (process.env.ENABLE_OLLAMA ?? '1') !== '0'
  const allowExternalLlm = (process.env.ENABLE_EXTERNAL_LLM ?? '0') === '1'
  const hasGroq = allowExternalLlm && Boolean(process.env.GROQ_API_KEY)
  const hasGemini = allowExternalLlm && Boolean(process.env.GEMINI_API_KEY)

  const attempts: Array<() => Promise<ProviderResult>> = []
  if (hasOllama) attempts.push(() => callOllama(expense))
  if (hasGroq) attempts.push(() => callGroq(expense))
  if (hasGemini) attempts.push(() => callGemini(expense))

  for (const attempt of attempts) {
    try {
      const result = await attempt()
      return result
    } catch {
      // fallback to next provider
    }
  }

  return null
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = auth()
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as { expenses?: ExpenseInput[] }
    const expenses = Array.isArray(body.expenses) ? body.expenses : []

    const base = classifyExpenses(expenses)
    const merged: ClassifiedExpense[] = []

    let promotedCount = 0
    let reviewedByLlm = 0
    const providerUsage: Partial<Record<ProviderName, number>> = {}

    for (const item of base) {
      const sourceExpense = expenses.find((expense) => expense.id === item.expenseId)
      if (!sourceExpense || item.rank !== 'REVIEW') {
        merged.push(item)
        continue
      }

      const sanitizedExpense = sanitizeExpenseForLlm(sourceExpense)
      const llm = await escalateReview(sanitizedExpense)
      if (!llm) {
        merged.push(item)
        continue
      }

      reviewedByLlm += 1
      providerUsage[llm.provider] = (providerUsage[llm.provider] ?? 0) + 1

      const judgement = llm.judgement
      const shouldAccept = judgement.rank !== 'REVIEW' && judgement.confidence >= 75

      if (!shouldAccept) {
        merged.push({
          ...item,
          reason: `${item.reason}（LLM判定: ${judgement.reason}）`,
          confidence: Math.max(item.confidence, judgement.confidence - 10),
          provider: llm.provider,
          model: llm.model,
        })
        continue
      }

      promotedCount += 1
      merged.push({
        ...item,
        rank: judgement.rank,
        confidence: judgement.confidence,
        reason: judgement.reason,
        accountItem: judgement.accountItem,
        taxCategory: judgement.taxCategory,
        businessRatio: judgement.businessRatio,
        provider: llm.provider,
        model: llm.model,
      })
    }

    return NextResponse.json({
      ok: true,
      classifications: merged,
      message:
        reviewedByLlm === 0
          ? 'LLM判定は実行されませんでした（キー未設定またはREVIEWなし）。'
          : `LLM判定を ${reviewedByLlm} 件実行し、${promotedCount} 件を自動確定しました。`,
      providerUsage,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `classification failed: ${error instanceof Error ? error.message : 'unknown'}`,
      },
      { status: 500 }
    )
  }
}
