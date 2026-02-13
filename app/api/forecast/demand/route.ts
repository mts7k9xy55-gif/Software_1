import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { spawn } from 'child_process'

type DailySale = { date: string; grossSales: number }

type ForecastPoint = { date: string; expectedSales: number; factor: number }

function eventFactorHeuristic(note: string): number {
  const n = note.toLowerCase()
  let factor = 1
  if (!n) return factor
  if (/(祭|festival|コンサート|concert|イベント|試合|game)/.test(n)) factor += 0.2
  if (/(雨|台風|snow|大雪|閉店|休業)/.test(n)) factor -= 0.15
  return Math.max(0.6, Math.min(1.5, factor))
}

function nextDates(days: number): string[] {
  const out: string[] = []
  const d = new Date()
  for (let i = 1; i <= days; i += 1) {
    const t = new Date(d)
    t.setDate(d.getDate() + i)
    out.push(t.toISOString().slice(0, 10))
  }
  return out
}

function movingAverageForecast(daily: DailySale[], days: number, factor: number): ForecastPoint[] {
  const values = daily.map((d) => Math.max(0, Number(d.grossSales || 0))).slice(-30)
  const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
  return nextDates(days).map((date) => ({
    date,
    expectedSales: Math.max(0, Math.floor(avg * factor)),
    factor,
  }))
}

async function runProphetForecast(daily: DailySale[], days: number, factor: number): Promise<ForecastPoint[] | null> {
  if ((process.env.ENABLE_PROPHET ?? '0') !== '1') return null

  const script = `
import json,sys,datetime
payload=json.loads(sys.stdin.read())
rows=payload.get('daily',[])
periods=int(payload.get('days',7))
factor=float(payload.get('factor',1.0))
try:
    import pandas as pd
    from prophet import Prophet
except Exception:
    print(json.dumps({'ok':False,'reason':'prophet_unavailable'}))
    sys.exit(0)
if not rows:
    print(json.dumps({'ok':False,'reason':'no_data'}))
    sys.exit(0)
df=pd.DataFrame([{'ds':r['date'],'y':float(r.get('grossSales',0))} for r in rows])
df['ds']=pd.to_datetime(df['ds'])
model=Prophet(daily_seasonality=True,weekly_seasonality=True,yearly_seasonality=True)
model.fit(df)
future=model.make_future_dataframe(periods=periods)
fc=model.predict(future).tail(periods)
out=[]
for _,r in fc.iterrows():
    out.append({'date':str(r['ds'].date()),'expectedSales':max(0,int(r['yhat']*factor)),'factor':factor})
print(json.dumps({'ok':True,'forecast':out}))
`

  const proc = spawn('python3', ['-c', script])
  const payload = JSON.stringify({ daily, days, factor })
  proc.stdin.write(payload)
  proc.stdin.end()

  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', (d) => {
    stdout += String(d)
  })
  proc.stderr.on('data', (d) => {
    stderr += String(d)
  })

  const exitCode: number = await new Promise((resolve) => proc.on('close', resolve))
  if (exitCode !== 0 || stderr) return null

  try {
    const parsed = JSON.parse(stdout) as { ok?: boolean; forecast?: ForecastPoint[] }
    if (!parsed.ok || !Array.isArray(parsed.forecast)) return null
    return parsed.forecast
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = auth()
    if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

    const body = (await request.json()) as { dailySales?: DailySale[]; days?: number; eventNote?: string }
    const dailySales = Array.isArray(body.dailySales) ? body.dailySales : []
    const days = Math.max(1, Math.min(30, Number(body.days ?? 7)))
    const factor = eventFactorHeuristic(String(body.eventNote ?? ''))

    const prophet = await runProphetForecast(dailySales, days, factor)
    if (prophet) {
      return NextResponse.json({ ok: true, method: 'prophet', forecast: prophet })
    }

    const fallback = movingAverageForecast(dailySales, days, factor)
    return NextResponse.json({ ok: true, method: 'fallback', forecast: fallback })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `forecast failed: ${error instanceof Error ? error.message : 'unknown'}` },
      { status: 500 }
    )
  }
}
