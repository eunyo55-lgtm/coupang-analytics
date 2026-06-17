// 실제 API 호출해서 연령 토큰 화이트리스트 동작 확인
const r = await fetch('https://coupang-analytics.vercel.app/api/keyword-suggest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    seeds: ['샌들', '아쿠아슈즈', '원피스'],  // 연령 토큰 없는 일반어
    useClaude: true,
    kidsOnly: true,
    fashionOnly: true,
    strictAge: false,
    maxResults: 50,
  })
})
const j = await r.json()
console.log('=== API 응답 ===')
console.log(`총 ${j.suggestions?.length}개 발굴 (시드 ${j.seedCount}개 확장)`)
console.log(`🎯 타겟 적합: ${j.ageMatchedCount}개`)
console.log(`제외: 성인 ${j.adultFiltered} | 비패션 ${j.nonFashionFiltered} | 작업 ${j.workFiltered}`)
console.log(`Claude 사용: ${j.claudeUsed}`)

if (j.suggestions && j.suggestions.length > 0) {
  console.log('\n=== 상위 15개 결과 ===')
  console.log('연령O | 키워드 | 월검색량')
  console.log('-----|--------|--------')
  for (const s of j.suggestions.slice(0, 15)) {
    const tok = s.hasAgeToken ? '🎯' : '⚠️'
    console.log(`${tok} | ${s.keyword.padEnd(25)} | ${s.total.toLocaleString()}`)
  }
}
