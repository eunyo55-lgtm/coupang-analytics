const r = await fetch('https://coupang-analytics.vercel.app/api/keyword-suggest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    seeds: ['수영복'],
    useClaude: true,
    kidsOnly: true,
    fashionOnly: true,
    strictAge: false,
    maxResults: 150,
  })
})
const j = await r.json()
console.log(`총 ${j.suggestions?.length}개 | 🎯 ${j.ageMatchedCount}개 | 시드 ${j.seedCount}개`)

const ageHit = (j.suggestions || []).filter(s => s.hasAgeToken)
console.log('\n=== 🎯 연령 토큰 포함 (상위 20개) ===')
ageHit.slice(0, 20).forEach(s => {
  console.log(`  ${s.keyword.padEnd(30)} | ${s.total.toLocaleString().padStart(8)}회`)
})
