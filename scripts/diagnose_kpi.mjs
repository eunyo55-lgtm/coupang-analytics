// Quick diagnosis: compare get_kpi_by_date vs get_daily_qty_by_year for the latest date
// Usage: node scripts/diagnose_kpi.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')

const env = {}
try {
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch (e) {
  console.error('[.env.local 읽기 실패]', e.message)
  process.exit(1)
}

const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 누락')
  process.exit(1)
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

async function rpc(name, params) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })
  const text = await r.text()
  try { return { ok: r.ok, status: r.status, data: JSON.parse(text) } }
  catch { return { ok: r.ok, status: r.status, raw: text } }
}

console.log('🔍 latestDate 결정용: get_daily_qty_by_year(2026)')
const daily = await rpc('get_daily_qty_by_year', { target_year: 2026 })
if (!daily.ok) { console.error('❌', daily); process.exit(1) }
const arr = daily.data
const last = arr[arr.length - 1]
const ymd = String(last.sale_date).slice(0, 10)
console.log(`  최신 row: ${ymd} → qty = ${last.total_qty}`)
console.log('')

console.log(`🔍 같은 날짜로 get_kpi_by_date(target_date=${ymd}):`)
const kpi = await rpc('get_kpi_by_date', { target_date: ymd })
console.log('  응답:', JSON.stringify(kpi.data))
console.log('')

console.log('🔍 어제 날짜(latest-1):')
const yest = new Date(ymd + 'T00:00:00')
yest.setDate(yest.getDate() - 1)
const yY = yest.toISOString().slice(0, 10)
const kpiY = await rpc('get_kpi_by_date', { target_date: yY })
console.log(`  ${yY} get_kpi_by_date 응답:`, JSON.stringify(kpiY.data))
console.log('')

console.log('🔍 그제 (latest-2):')
const yest2 = new Date(ymd + 'T00:00:00')
yest2.setDate(yest2.getDate() - 2)
const y2 = yest2.toISOString().slice(0, 10)
const kpiY2 = await rpc('get_kpi_by_date', { target_date: y2 })
console.log(`  ${y2} get_kpi_by_date 응답:`, JSON.stringify(kpiY2.data))
console.log('')

// daily26 마지막 5개
console.log('🔍 daily26 마지막 5일 (get_daily_qty_by_year 결과):')
for (const r of arr.slice(-5)) {
  console.log(`  ${String(r.sale_date).slice(0,10)}: qty=${r.total_qty}`)
}
