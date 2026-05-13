'use client'

import { useState, useEffect } from 'react'
import { useApp } from '@/lib/store'
import { supabase } from '@/lib/supabase'
import { toYMD } from '@/lib/dateUtils'
import CoupangAdUpload from '@/components/CoupangAdUpload'
import AdSignalCards from '@/components/AdSignalCards'
import AdPerformanceCharts from '@/components/AdPerformanceCharts'
import AdBreakdownTables from '@/components/AdBreakdownTables'
import AdKpiSparkCards from '@/components/AdKpiSparkCards'

/**
 * 광고 현황 페이지 — 쿠팡 광고 콘솔 CSV 업로드 기반.
 *  ┌ 업로드 박스 (CSV 드래그)
 *  ├ KPI 카드 (광고비/매출/ROAS/ACoS + 운영지표 + 스파크라인 + 전 기간 대비)
 *  ├ 자동 신호 카드 (위험/주의/기회 + 구체적 액션)
 *  ├ 일별/주간 성과 차트
 *  └ 차원별 성과 (캠페인/상품/키워드/노출지면 — 독립 날짜 필터)
 */
export default function AdPage() {
  const { state, dispatch } = useApp()
  const { dateRange } = state

  type AdDaily = { date: string; ad_cost: number; revenue_14d: number; revenue_1d: number; impressions: number; clicks: number }
  const [csvDailyAll, setCsvDailyAll] = useState<AdDaily[]>([])

  useEffect(() => { loadCsvDaily() }, [])

  async function loadCsvDaily() {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('coupang_ad_daily_summary')
        .select('date, ad_cost, revenue_14d, revenue_1d, impressions, clicks')
        .order('date', { ascending: true })
      if (error) { console.warn('[AdPage] coupang_ad_daily_summary load:', error.message); return }
      setCsvDailyAll((data as AdDaily[]) || [])
    } catch (e) { console.warn('[AdPage] csv daily load:', e) }
  }

  const dateFromY = toYMD(dateRange.from)
  const dateToY   = toYMD(dateRange.to)

  // dateRange 외부 데이터 안내
  const csvDaily = csvDailyAll.filter(r => r.date >= dateFromY && r.date <= dateToY)
  const csvOutOfRange = csvDailyAll.length - csvDaily.length
  const dbMinDate = csvDailyAll[0]?.date
  const dbMaxDate = csvDailyAll[csvDailyAll.length - 1]?.date

  function applyAdDataRange() {
    if (!dbMinDate || !dbMaxDate) return
    dispatch({
      type: 'SET_DATE_RANGE',
      payload: {
        from: new Date(dbMinDate + 'T00:00:00'),
        to:   new Date(dbMaxDate + 'T00:00:00'),
        label: `광고 데이터 ${dbMinDate} ~ ${dbMaxDate}`,
        preset: 'custom',
      },
    })
  }

  return (
    <div>
      {/* 광고 리포트 CSV 업로드 */}
      <CoupangAdUpload onComplete={loadCsvDaily} />

      {/* dateRange 외부에 광고 데이터가 있으면 안내 */}
      {csvDailyAll.length > 0 && csvDaily.length === 0 && (
        <div
          style={{
            background: '#fef3c7', border: '1px solid #fcd34d',
            padding: '12px 14px', borderRadius: 8, marginBottom: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 13, color: '#78350f' }}>
            ⚠️ 업로드된 광고 데이터 <b>{csvDailyAll.length}일치</b>가 현재 표시 기간 외부에 있어 KPI에 반영되지 않았습니다.
            DB 데이터 범위: <b>{dbMinDate} ~ {dbMaxDate}</b>
          </div>
          <button
            onClick={applyAdDataRange}
            style={{
              padding: '6px 14px', background: '#f59e0b', color: 'white', border: 'none',
              borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >🎯 해당 기간으로 보기</button>
        </div>
      )}
      {csvDailyAll.length > 0 && csvDaily.length > 0 && csvOutOfRange > 0 && (
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          광고 데이터 표시 중: {csvDaily.length}일 / DB 전체 {csvDailyAll.length}일 ({csvOutOfRange}일은 현재 기간 밖)
        </div>
      )}

      {/* KPI: 스파크라인 + 전 동일 기간 대비 (메인 4 + 운영 4) */}
      <AdKpiSparkCards csvDailyAll={csvDailyAll} dateFrom={dateFromY} dateTo={dateToY} />

      {/* 자동 신호 + 액션 가이드 */}
      <AdSignalCards dateFrom={dateFromY} dateTo={dateToY} />

      {/* 일별 추이 + 주간 집계 */}
      <AdPerformanceCharts dateFrom={dateFromY} dateTo={dateToY} />

      {/* 차원별 성과 (자체 날짜 필터) */}
      <AdBreakdownTables defaultDateFrom={dateFromY} defaultDateTo={dateToY} />
    </div>
  )
}
