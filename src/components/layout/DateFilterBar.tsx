'use client'

import { useApp } from '@/lib/store'
import { getPresetRange, toYMD, fromYMD } from '@/lib/dateUtils'

const PRESETS = [
  { key: 'today',     label: '오늘' },
  { key: 'yesterday', label: '전일' },
  { key: 'week',      label: '전주 (금~목)' },
  { key: 'month',     label: '이번 달' },
  { key: 'last30',    label: '최근 30일' },
  { key: 'total',     label: '전체' },
]

const today = new Date()
today.setHours(0, 0, 0, 0)

export default function DateFilterBar() {
  const { state, dispatch } = useApp()
  const { dateRange } = state

  function applyPreset(preset: string) {
    const range = getPresetRange(preset, today)
    dispatch({ type: 'SET_DATE_RANGE', payload: range })
  }

  function applyCustom() {
    const fromEl = document.getElementById('date-from') as HTMLInputElement
    const toEl   = document.getElementById('date-to')   as HTMLInputElement
    if (!fromEl.value || !toEl.value) return
    const from = fromYMD(fromEl.value)
    const to   = fromYMD(toEl.value)
    if (from > to) { alert('시작일이 종료일보다 늦을 수 없습니다.'); return }
    dispatch({
      type: 'SET_DATE_RANGE',
      payload: { from, to, label: `${fromEl.value} ~ ${toEl.value}`, preset: 'custom' },
    })
  }

  return (
    <div className="date-bar">
      <div className="date-presets">
        {PRESETS.map(p => (
          <button
            key={p.key}
            className={`dp${dateRange.preset === p.key ? ' active' : ''}`}
            onClick={() => applyPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="date-sep" />
      <div className="date-range">
        <input
          type="date"
          id="date-from"
          className="date-input"
          defaultValue={toYMD(dateRange.from)}
        />
        <span className="date-range-sep">~</span>
        <input
          type="date"
          id="date-to"
          className="date-input"
          defaultValue={toYMD(dateRange.to)}
        />
        <button className="date-apply" onClick={applyCustom}>적용</button>
      </div>
      <span className="date-label-txt">{dateRange.label}</span>
    </div>
  )
}
