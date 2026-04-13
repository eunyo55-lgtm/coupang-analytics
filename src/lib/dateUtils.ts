import { DateRange } from '@/types'

export function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function fromYMD(s: string): Date {
  return new Date(s + 'T00:00:00')
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

export function formatKorean(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export function getPresetRange(preset: string, today: Date): DateRange {
  const t = new Date(today)
  t.setHours(0, 0, 0, 0)

  switch (preset) {
    case 'today': {
      return { from: new Date(t), to: new Date(t), label: '오늘', preset }
    }
    case 'yesterday': {
      const y = new Date(t)
      y.setDate(y.getDate() - 1)
      return { from: y, to: new Date(y), label: '전일 기준', preset }
    }
    case 'week': {
      // Last full week: Friday ~ Thursday
      const dow = t.getDay() // 0=Sun
      const lastThu = new Date(t)
      lastThu.setDate(t.getDate() - ((dow + 3) % 7 + 1))
      const lastFri = new Date(lastThu)
      lastFri.setDate(lastThu.getDate() - 6)
      return { from: lastFri, to: lastThu, label: '전주 (금~목)', preset }
    }
    case 'month': {
      const first = new Date(t.getFullYear(), t.getMonth(), 1)
      return { from: first, to: new Date(t), label: '이번 달', preset }
    }
    case 'last30': {
      const f = new Date(t)
      f.setDate(f.getDate() - 29)
      return { from: f, to: new Date(t), label: '최근 30일', preset }
    }
    default: {
      // total — 3 years back
      const f = new Date(t)
      f.setFullYear(f.getFullYear() - 3)
      return { from: f, to: new Date(t), label: '전체', preset: 'total' }
    }
  }
}

export function filterByRange<T extends { date: string }>(
  items: T[],
  range: DateRange
): T[] {
  const f = toYMD(range.from)
  const t = toYMD(range.to)
  return items.filter(item => item.date >= f && item.date <= t)
}
