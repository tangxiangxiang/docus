import { parseDiaryDate, type DiaryDate } from '../../../shared/diaryProtocol'

/**
 * The smallest Diary projection the presentation adapter needs for MVP.
 * This type intentionally has no Calendar-library fields.
 */
export interface DiaryCalendarDay {
  date: DiaryDate
  hasDiary: boolean
}

/** A visible month, kept separate from the DiaryDate domain identity. */
export interface DiaryCalendarMonth {
  year: number
  month: number
}

export interface CalendarDayFields {
  year: number
  month: number
  day: number
}

export interface DiaryCalendarAttribute {
  key: string
  dates: string[]
  dot: true
  customData: DiaryCalendarDay
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Convert VCalendar's local civil fields to the validated DiaryDate identity.
 * No Date object or UTC serialization is involved in this conversion.
 */
export function diaryDateFromCalendarDay(
  day: Pick<CalendarDayFields, 'year' | 'month' | 'day'> | null | undefined,
): DiaryDate | null {
  if (!day || !isInteger(day.year) || !isInteger(day.month) || !isInteger(day.day)) {
    return null
  }

  return parseDiaryDate(`${String(day.year).padStart(4, '0')}-${pad(day.month)}-${pad(day.day)}`)
}

/** Convert a browser-local Date to a date-only DiaryDate without UTC slicing. */
export function diaryDateFromLocalDate(value: Date): DiaryDate | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null

  return parseDiaryDate(
    `${String(value.getFullYear()).padStart(4, '0')}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
  )
}

/** Return the browser-local civil date for Today presentation. */
export function localCivilToday(): DiaryDate | null {
  return diaryDateFromLocalDate(new Date())
}

/** Return the browser-local month used when no initial month is supplied. */
export function diaryCalendarMonthFromLocalDate(value = new Date()): DiaryCalendarMonth {
  return {
    year: value.getFullYear(),
    month: value.getMonth() + 1,
  }
}

/** Validate a library-independent page/month payload. */
export function diaryCalendarMonthFromPage(value: unknown): DiaryCalendarMonth | null {
  if (!value || typeof value !== 'object') return null
  const page = value as { year?: unknown; month?: unknown }
  if (!isInteger(page.year) || !isInteger(page.month)) return null
  if (page.month < 1 || page.month > 12) return null

  return { year: page.year, month: page.month }
}

/** Convert a validated DiaryDate into a local Date only for Calendar navigation. */
export function localCalendarDateForDiaryDate(date: DiaryDate): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

/** Stable key used for one marker per Diary date. */
export function diaryCalendarAttributeKey(date: DiaryDate): string {
  return `diary-${date}`
}

/**
 * Normalize a projection defensively for presentation. Invalid entries are
 * ignored, and duplicate dates collapse to one record with an OR'd marker.
 * This protects the UI from duplicate marker artifacts without repairing
 * domain data.
 */
export function normalizeDiaryDays(
  days: readonly DiaryCalendarDay[] | null | undefined,
): DiaryCalendarDay[] {
  const byDate = new Map<string, DiaryCalendarDay>()

  for (const input of days ?? []) {
    if (!input || typeof input !== 'object') continue
    const candidate = input as Partial<DiaryCalendarDay>
    const date = parseDiaryDate(candidate.date)
    if (!date) continue

    const existing = byDate.get(date)
    if (existing) {
      existing.hasDiary = existing.hasDiary || candidate.hasDiary === true
      continue
    }

    byDate.set(date, {
      date,
      hasDiary: candidate.hasDiary === true,
    })
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

/** Map existing Diary dates to VCalendar's attribute-shaped presentation data. */
export function diaryCalendarAttributes(
  days: readonly DiaryCalendarDay[] | null | undefined,
): DiaryCalendarAttribute[] {
  return normalizeDiaryDays(days)
    .filter((day) => day.hasDiary)
    .map((day) => ({
      key: diaryCalendarAttributeKey(day.date),
      dates: [day.date],
      dot: true as const,
      customData: day,
    }))
}

/** Safely read a Diary projection from a VCalendar attribute/customData value. */
export function diaryDayFromCalendarAttribute(value: unknown): DiaryCalendarDay | null {
  if (!value || typeof value !== 'object') return null
  const customData = (value as { customData?: unknown }).customData
  if (!customData || typeof customData !== 'object') return null

  const candidate = customData as Partial<DiaryCalendarDay>
  const date = parseDiaryDate(candidate.date)
  if (!date || typeof candidate.hasDiary !== 'boolean') return null
  return { date, hasDiary: candidate.hasDiary }
}

export function hasDiaryCalendarAttribute(attributes: unknown): boolean {
  return Array.isArray(attributes)
    && attributes.some((attribute) => diaryDayFromCalendarAttribute(attribute)?.hasDiary === true)
}
