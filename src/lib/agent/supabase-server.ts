// 서버 전용 Supabase 클라이언트. API Route에서만 import.
// 환경변수는 함수 호출 시점에 검증 (Next build 시 routes를 수집할 때 throw 방지).
import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null
export function getServerSupabase(): SupabaseClient {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY required')
  }
  _client = createClient(url, key, { db: { schema: 'public' } })
  return _client
}
