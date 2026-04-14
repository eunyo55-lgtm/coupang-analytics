'use client'

import React, { createContext, useContext, useReducer, ReactNode, useEffect, useRef } from 'react'
import type { DateRange, SalesRow, InventoryItem, RankingEntry, AdEntry, ParseResult } from '@/types'
import { getPresetRange } from '@/lib/dateUtils'

const KEY = 'ca_v5'

function save(s: AppState) {
  if (typeof window === 'undefined') return
  try {
    const p: Record<string, unknown> = {
      masterData: s.masterData, salesData: s.salesData,
      ordersData: s.ordersData, supplyData: s.supplyData,
      hasData: true,
      dateRangePreset: s.dateRange.preset || 'total', // 날짜 필터 저장
    }
    const str = JSON.stringify(p)
    if (str.length >= 4_500_000) {
      p.salesData = s.salesData.slice(-Math.floor(s.salesData.length/2))
    }
    localStorage.setItem(KEY, JSON.stringify(p))
    console.log('[CA] saved', s.salesData.length, 'sales rows, preset:', p.dateRangePreset)
  } catch(e) { console.warn('[CA] save failed', e) }
}

function load() {
  try {
    const r = localStorage.getItem(KEY)
    if (!r) return null
    const d = JSON.parse(r) as Partial<AppState> & { dateRangePreset?: string }
    // dateRange 복원
    if (d.dateRangePreset && !(d as AppState).dateRange) {
      const today = new Date(); today.setHours(0,0,0,0)
      ;(d as AppState).dateRange = getPresetRange(d.dateRangePreset, today)
    }
    return d as Partial<AppState>
  } catch { return null }
}

function mergeSales(prev: SalesRow[], next: SalesRow[]) {
  if (!prev.length) return next
  const m = new Map<string,SalesRow>()
  prev.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  next.forEach(r => m.set(`${r.date}|${r.productName}|${r.option}`, r))
  return Array.from(m.values()).sort((a,b) => a.date.localeCompare(b.date))
}
function mergeRaw(prev: Record<string,unknown>[], next: Record<string,unknown>[]) {
  if (!prev.length) return next
  const k = (r: Record<string,unknown>) => `${r['상품명']||r['productName']||r['item']||''}|${r['옵션']||r['option']||''}`
  const m = new Map<string,Record<string,unknown>>()
  prev.forEach(r => m.set(k(r),r)); next.forEach(r => m.set(k(r),r))
  return Array.from(m.values())
}

export interface AppState {
  dateRange:DateRange; masterData:Record<string,unknown>[]; salesData:SalesRow[]
  ordersData:Record<string,unknown>[]; supplyData:Record<string,unknown>[]
  inventory:InventoryItem[]; rankings:RankingEntry[]; adEntries:AdEntry[]
  parseLog:string[]; isAnalyzing:boolean; hasData:boolean
}

const today = new Date(); today.setHours(0,0,0,0)
const init: AppState = {
  dateRange:getPresetRange('yesterday',today), masterData:[], salesData:[], ordersData:[], supplyData:[],
  inventory:[], rankings:[], adEntries:[], parseLog:[], isAnalyzing:false, hasData:false,
}

export type Action =
  | {type:'SET_DATE_RANGE';payload:DateRange} | {type:'SET_PARSE_RESULT';payload:ParseResult}
  | {type:'HYDRATE';payload:Partial<AppState>} | {type:'SET_INVENTORY';payload:InventoryItem[]}
  | {type:'ADD_RANKING';payload:RankingEntry} | {type:'SET_RANKINGS';payload:RankingEntry[]}
  | {type:'ADD_AD_ENTRY';payload:AdEntry} | {type:'SET_AD_ENTRIES';payload:AdEntry[]}
  | {type:'DELETE_AD_ENTRY';payload:number} | {type:'APPEND_LOG';payload:string}
  | {type:'SET_ANALYZING';payload:boolean} | {type:'RESET'}

function reducer(s: AppState, a: Action): AppState {
  switch(a.type) {
    case 'SET_DATE_RANGE':  return {...s,dateRange:a.payload}
    case 'HYDRATE':         return {...s,...a.payload}
    case 'SET_PARSE_RESULT':{
      const {key,data}=a.payload
      if(key==='sales')  return {...s,salesData:mergeSales(s.salesData,data as unknown as SalesRow[]),hasData:true}
      if(key==='master') return {...s,masterData:mergeRaw(s.masterData,data),hasData:true}
      if(key==='orders') return {...s,ordersData:mergeRaw(s.ordersData,data),hasData:true}
      return {...s,supplyData:data,hasData:true}
    }
    case 'SET_INVENTORY':  return {...s,inventory:a.payload}
    case 'ADD_RANKING':    return {...s,rankings:[a.payload,...s.rankings]}
    case 'SET_RANKINGS':   return {...s,rankings:a.payload}
    case 'ADD_AD_ENTRY':   return {...s,adEntries:[...s.adEntries,a.payload]}
    case 'SET_AD_ENTRIES': return {...s,adEntries:a.payload}
    case 'DELETE_AD_ENTRY':return {...s,adEntries:s.adEntries.filter((_,i)=>i!==a.payload)}
    case 'APPEND_LOG':     return {...s,parseLog:[...s.parseLog,a.payload]}
    case 'SET_ANALYZING':  return {...s,isAnalyzing:a.payload}
    case 'RESET':          return {...init,dateRange:s.dateRange}
    default: return s
  }
}

const Ctx = createContext<{state:AppState;dispatch:React.Dispatch<Action>}|null>(null)

export function AppProvider({children}:{children:ReactNode}) {
  const [state, dispatch] = useReducer(reducer, init)
  const savedCount = useRef(0) // 복원으로 인한 첫 save 스킵용

  // 마운트 시 복원
  useEffect(() => {
    const d = load()
    if (d?.hasData) {
      savedCount.current = 1 // 복원 직후 save 1회 스킵
      dispatch({type:'HYDRATE', payload:d})
    }
  }, [])

  // state 변경마다 저장 (복원 직후 1회 스킵)
  useEffect(() => {
    if (!state.hasData) return
    if (savedCount.current === 1) { savedCount.current = 0; return }
    save(state)
  }, [state]) // eslint-disable-line

  return <Ctx.Provider value={{state,dispatch}}>{children}</Ctx.Provider>
}

export function useApp() {
  const c = useContext(Ctx)
  if(!c) throw new Error('useApp must be within AppProvider')
  return c
}
