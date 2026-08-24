<script setup lang="ts">
import { computed, ref } from 'vue'
import { Calendar } from 'v-calendar'
import 'v-calendar/style.css'
import { parseDiaryDate, type DiaryDate } from '../../../../shared/diaryProtocol'

type CalendarDayLike = {
  year: number
  month: number
  day: number
  attributes?: Array<{ customData?: { date?: string } }>
}

type CalendarPageLike = {
  month?: number
  year?: number
}

type CalendarControls = {
  movePrev: () => Promise<boolean>
  moveNext: () => Promise<boolean>
}

const calendarRef = ref<CalendarControls | null>(null)
const showCalendar = ref(true)
const hasDiary = ref(true)
const isDark = ref(false)
const locale = ref('en-US')
const firstDayOfWeek = ref<1 | 7>(1)
const currentPage = ref('2026-08')
const selectedDate = ref<DiaryDate | null>(null)
const clickedCustomData = ref('')

const targetDate = parseDiaryDate('2026-08-24')!

const calendarAttributes = computed(() => hasDiary.value
  ? [{
      key: 'diary-2026-08-24',
      dates: ['2026-08-24'],
      dot: true,
      customData: { date: targetDate, hasDiary: true },
    }]
  : [])

function diaryDateFromCalendarDay(day: Pick<CalendarDayLike, 'year' | 'month' | 'day'>): DiaryDate | null {
  const value = `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`
  return parseDiaryDate(value)
}

function hasTargetAttribute(attributes: unknown): boolean {
  if (!Array.isArray(attributes)) return false
  return attributes.some((attribute) => {
    if (!attribute || typeof attribute !== 'object') return false
    const customData = (attribute as { customData?: { date?: string }}).customData
    return customData?.date === targetDate
  })
}

function onDayClick(day: CalendarDayLike): void {
  selectedDate.value = diaryDateFromCalendarDay(day)
  const targetAttribute = day.attributes?.find((attribute) => attribute.customData?.date === targetDate)
  clickedCustomData.value = targetAttribute?.customData?.date ?? ''
}

function onDidMove(pages: CalendarPageLike[]): void {
  const page = pages[0]
  if (!page?.year || !page.month) return
  currentPage.value = `${page.year}-${String(page.month).padStart(2, '0')}`
}

async function movePrev(): Promise<void> {
  await calendarRef.value?.movePrev()
}

async function moveNext(): Promise<void> {
  await calendarRef.value?.moveNext()
}

function toggleIndicator(): void {
  hasDiary.value = !hasDiary.value
}

function toggleLocale(): void {
  locale.value = locale.value === 'en-US' ? 'zh-CN' : 'en-US'
}

function toggleFirstDayOfWeek(): void {
  firstDayOfWeek.value = firstDayOfWeek.value === 1 ? 7 : 1
}

function toggleTheme(): void {
  isDark.value = !isDark.value
}

function toggleCalendar(): void {
  showCalendar.value = !showCalendar.value
}
</script>

<template>
  <main
    data-testid="vcalendar-probe"
    :data-page="currentPage"
    :data-locale="locale"
    :data-theme="isDark ? 'dark' : 'light'"
    :data-first-day-of-week="firstDayOfWeek"
  >
    <div class="probe-controls">
      <button data-testid="prev-page" type="button" @click="movePrev">Previous</button>
      <button data-testid="next-page" type="button" @click="moveNext">Next</button>
      <button data-testid="toggle-indicator" type="button" @click="toggleIndicator">Toggle indicator</button>
      <button data-testid="toggle-locale" type="button" @click="toggleLocale">Toggle locale</button>
      <button data-testid="toggle-week-start" type="button" @click="toggleFirstDayOfWeek">Toggle week start</button>
      <button data-testid="toggle-theme" type="button" @click="toggleTheme">Toggle theme</button>
      <button data-testid="toggle-calendar" type="button" @click="toggleCalendar">Toggle calendar</button>
    </div>

    <output data-testid="selected-date">{{ selectedDate ?? '' }}</output>
    <output data-testid="clicked-custom-data">{{ clickedCustomData }}</output>

    <Calendar
      v-if="showCalendar"
      ref="calendarRef"
      :initial-page="{ month: 8, year: 2026 }"
      :attributes="calendarAttributes"
      :locale="locale"
      :first-day-of-week="firstDayOfWeek"
      :masks="{ title: 'MMMM YYYY' }"
      :is-dark="isDark"
      @dayclick="onDayClick"
      @did-move="onDidMove"
      @update:pages="onDidMove"
    >
      <template #day-content="{ day, attributes, dayProps, dayEvents }">
        <button
          v-bind="dayProps"
          v-on="dayEvents"
          type="button"
          :data-date="diaryDateFromCalendarDay(day) ?? ''"
        >
          {{ day.label }}
          <span v-if="hasTargetAttribute(attributes)" data-testid="custom-marker">mood-probe</span>
        </button>
      </template>
    </Calendar>
  </main>
</template>
