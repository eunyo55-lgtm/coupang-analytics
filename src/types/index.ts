// ── Date Range ──
export interface DateRange {
  from: Date
  to: Date
  label: string
  preset: string
}

// ── Sales ──
export interface SalesRow {
  date: string        // YYYY-MM-DD
  productName: string
  option: string
  qty: number
  revenue: number
  isReturn: boolean
}

export interface SalesByProduct {
  name: string
  option: string
  qty: number
  revenue: number
}

export interface DailySales {
  date: string
  revenue: number
  qty: number
}

// ── Inventory ──
export interface InventoryItem {
  name: string
  option: string
  stock: number
  supplyQty: number
  dailySales: number
  daysLeft: number
  recommendOrder: number
  status: 'danger' | 'warn' | 'ok'
}

// ── Supply ──
export interface SupplyItem {
  id?: string
  name: string
  option: string
  qty: number
  expectedDate: string
  status: 'confirmed' | 'transit' | 'preparing'
  createdAt?: string
}

// ── Ranking ──
export interface RankingEntry {
  id?: string
  productName: string
  keyword: string
  rankToday: number
  rankYesterday: number
  date: string
  createdAt?: string
}

export interface NaverKeywordResult {
  keyword: string
  pc: number
  mobile: number
  total: number
  competition: 'high' | 'mid' | 'low'
}

// ── Ad ──
export interface AdEntry {
  id?: string
  productName: string
  adCost: number
  adRevenue: number
  clicks: number
  impressions: number
  date: string
  createdAt?: string
}

// ── Upload / Parse ──
export interface ParseResult {
  key: 'master' | 'sales' | 'orders' | 'supply'
  rows: number
  columns: string[]
  data: Record<string, unknown>[]
  error?: string
}

// ── Supabase DB types ──
export interface Database {
  public: {
    Tables: {
      rankings: {
        Row: RankingEntry
        Insert: Omit<RankingEntry, 'id' | 'createdAt'>
        Update: Partial<RankingEntry>
      }
      ad_entries: {
        Row: AdEntry
        Insert: Omit<AdEntry, 'id' | 'createdAt'>
        Update: Partial<AdEntry>
      }
      supply_items: {
        Row: SupplyItem
        Insert: Omit<SupplyItem, 'id' | 'createdAt'>
        Update: Partial<SupplyItem>
      }
    }
  }
}
