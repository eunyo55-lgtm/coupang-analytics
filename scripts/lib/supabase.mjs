// Lightweight Supabase REST client for cron scripts (no SDK needed).
// Uses the anon key — relies on RLS allow_all policies already in the schema.

const SUPA_URL = process.env.SUPABASE_URL || 'https://vzyfygmzqqiwgrcuydti.supabase.co'
const SUPA_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPA_KEY) {
  console.error('[supabase] Missing SUPABASE_ANON_KEY env var')
  process.exit(1)
}

const baseHeaders = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
}

export async function selectAll(table, query = '') {
  const url = `${SUPA_URL}/rest/v1/${table}${query ? '?' + query : ''}`
  const res = await fetch(url, { headers: baseHeaders })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[supabase] select ${table} failed: ${res.status} ${text}`)
  }
  return res.json()
}

export async function insertRows(table, rows) {
  if (!rows.length) return 0
  const url = `${SUPA_URL}/rest/v1/${table}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...baseHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[supabase] insert ${table} failed: ${res.status} ${text}`)
  }
  return rows.length
}

// Upsert via PostgREST: requires unique constraint on the conflict column(s).
// For tables without a hard constraint, do delete-then-insert as workaround.
export async function upsertRows(table, rows, onConflict) {
  if (!rows.length) return 0
  const url = `${SUPA_URL}/rest/v1/${table}?on_conflict=${onConflict}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[supabase] upsert ${table} failed: ${res.status} ${text}`)
  }
  return rows.length
}

export async function deleteWhere(table, query) {
  const url = `${SUPA_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: baseHeaders,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[supabase] delete ${table} failed: ${res.status} ${text}`)
  }
}
