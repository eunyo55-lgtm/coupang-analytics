'use client'

import React, { createContext, useContext, useReducer, ReactNode, useEffect } from 'react'
import type {
  DateRange, SalesRow, InventoryItem,
  RankingEntry, AdEntry, ParseResult
} from '@/types'
import { getPresetRange } from '@/lib/dateUtils'

// ── localStorage 유틸 ──
const STORAGE_KEY = 'coupang_analytics_data'

function saveToStorage(state: AppState) {
  try {
    const toSave = {
      masterData: state.masterData,
      salesData:  state.salesData,
      ordersData: state.ordersData,
      supplyData: state.supplyData,
      hasData:    state.hasData,
    }
    const str = JSON.stringify(toSave)
    if (str.length < 4_500_000) {
      localStorage.setItem(STORAGE_KEY, str)
    } else {
      // 용량 초과 시 판매 데이터를 절반으로 줄여서 저장 (최신 우선)
      toSave.salesData = state.salesData.slice(-Math.floor(state.salesData.length / 2))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    }
  } catch {
    console.warn('[store] localStorage save failed — data too large')
  }
}

function loadFromStorage(): Partial<AppState> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch { return {} }
}

// ── 누적 merge 헬퍼 ──
// 판매: date + productName + option 조합으로 중복 제거 후 합산
function mergeSales(existing: SalesRow[], incoming: SalesRow[]): SalesRow[] {
  if (!existing.length) return incoming

  // 기존 데이터를 key → row 맵으로 변환
  const map = new Map<string, SalesRow>()
  existing.forEach(r => {
    const key = `${r.date}||${r.productName}||${r.option}`
    map.set(key, r)
  })

  // 새 데이터: 같은 key가 있으면 덮어쓰기 (새 파일이 더 정확한 값으로 간주)
  incoming.forEach(r => {
    const key = `${r.date}||${r.productName}||${r.option}`
    map.set(key, r)
  })

  // 날짜 오름차순 정렬
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// 마스터/발주/공급: 상품명+옵션 기준 중복 제거 (새 데이터 우선)
function mergeByName(
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[]
): Record<string, unknown>[] {
  if (!existing.length) return incoming
  const nameKey = (r: Record<string, unknown>) => {
    const name   = r['상품명'] || r['productName'] || r['item'] || r['노출상품명'] || ''
    const option = r['옵션']  || r['option']     || r['옵션명'] || ''
    return `${name}||${option}`
  }
  const map = new Map<string, Record<string, unknown>>()
  existing.forEach(r => map.set(nameKey(r), r))
  incoming.forEach(r => map.set(nameKey(r), r)) // 새 데이터가 덮어씀
  return Array.from(map.values())
}

// ── State ──
interface AppState {
  dateRange: DateRange
  masterData: Record<string, unknown>[]
  salesData: SalesRow[]
  ordersData: Record<string, unknown>[]
  supplyData: Record<string, unknown>[]
  inventory: InventoryItem[]
  rankings: RankingEntry[]
  adEntries: AdEntry[]
  parseLog: string[]
  isAnalyzing: boolean
  hasData: boolean
}

const today = new Date()
today.setHours(0, 0, 0, 0)

const initialState: AppState = {
  dateRange:   getPresetRange('yesterday', today),
  masterData:  [],
  salesData:   [],
  ordersData:  [],
  supplyData:  [],
  inventory:   [],
  rankings:    [],
  adEntries:   [],
  parseLog:    [],
  isAnalyzing: false,
  hasData:     false,
}

// ── Actions ──
type Action =
  | { type: 'SET_DATE_RANGE'; payload: DateRange }
  | { type: 'SET_PARSE_RESULT'; payload: ParseResult }
  | { type: 'SET_INVENTORY'; payload: InventoryItem[] }
  | { type: 'ADD_RANKING'; payload: RankingEntry }
  | { type: 'SET_RANKINGS'; payload: RankingEntry[] }
  | { type: 'ADD_AD_ENTRY'; payload: AdEntry }
  | { type: 'SET_AD_ENTRIES'; payload: AdEntry[] }
  | { type: 'DELETE_AD_ENTRY'; payload: number }
  | { type: 'APPEND_LOG'; payload: string }
  | { type: 'SET_ANALYZING'; payload: boolean }
  | { type: 'RESET' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_DATE_RANGE':
      return { ...state, dateRange: action.payload }

    case 'SET_PARSE_RESULT': {
      const { key, data } = action.payload

      if (key === 'sales') {
        const incoming = data as unknown as SalesRow[]
        const merged   = mergeSales(state.salesData, incoming)
        return { ...state, salesData: merged, hasData: true }
      }

      if (key === 'master') {
        const merged = mergeByName(state.masterData, data)
        return { ...state, masterData: merged, hasData: true }
      }

      if (key === 'orders') {
        const merged = mergeByName(state.ordersData, data)
        return { ...state, ordersData: merged, hasData: true }
      }

      if (key === 'supply') {
        // 공급 중 수량은 항상 최신 파일로 교체 (재고 현황이 변하므로)
        return { ...state, supplyData: data, hasData: true }
      }

      return { ...state, hasData: true }
    }

    case 'SET_INVENTORY':
      return { ...state, inventory: action.payload }

    case 'ADD_RANKING':
      return { ...state, rankings: [action.payload, ...state.rankings] }

    case 'SET_RANKINGS':
      return { ...state, rankings: action.payload }

    case 'ADD_AD_ENTRY':
      return { ...state, adEntries: [...state.adEntries, action.payload] }

    case 'SET_AD_ENTRIES':
      return { ...state, adEntries: action.payload }

    case 'DELETE_AD_ENTRY':
      return { ...state, adEntries: state.adEntries.filter((_, i) => i !== action.payload) }

    case 'APPEND_LOG':
      return { ...state, parseLog: [...state.parseLog, action.payload] }

    case 'SET_ANALYZING':
      return { ...state, isAnalyzing: action.payload }

    case 'RESET': {
      if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY)
      return { ...initialState, dateRange: state.dateRange }
    }

    default:
      return state
  }
}

// ── Context ──
const AppContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<Action>
} | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState, (base) => {
    const saved = loadFromStorage()
    return { ...base, ...saved }
  })

  // 데이터 변경 시 localStorage에 자동 저장
  useEffect(() => {
    if (state.hasData) saveToStorage(state)
  }, [state.masterData, state.salesData, state.ordersData, state.supplyData, state.hasData]) // eslint-disable-line

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
