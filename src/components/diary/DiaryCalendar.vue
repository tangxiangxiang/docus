<script setup lang="ts">
import { computed, ref } from 'vue'
import { Calendar } from 'v-calendar'
import 'v-calendar/style.css'
import { useI18n } from '../../composables/useI18n'
import { useTheme } from '../../composables/useTheme'
import type { DiaryDate } from '../../../shared/diaryProtocol'
import {
  diaryCalendarAttributes,
  diaryCalendarMonthFromLocalDate,
  diaryCalendarMonthFromPage,
  diaryDateFromCalendarDay,
  hasDiaryCalendarAttribute,
  localCalendarDateForDiaryDate,
  localCivilToday,
  normalizeDiaryDays,
  type DiaryCalendarDay,
  type DiaryCalendarMonth,
} from './diaryCalendarAdapter'

type CalendarDayLike = {
  year: number
  month: number
  day: number
  label?: string
  ariaLabel?: string
}

type CalendarInstance = {
  move: (target: Date) => Promise<boolean>
  movePrev: () => Promise<boolean>
  moveNext: () => Promise<boolean>
}

const props = withDefaults(defineProps<{
  days: readonly DiaryCalendarDay[]
  loading?: boolean
  error?: string | null
  initialMonth?: DiaryCalendarMonth
}>(), {
  loading: false,
  error: null,
})

const emit = defineEmits<{
  'date-selected': [date: DiaryDate]
  'month-change': [month: DiaryCalendarMonth]
}>()

const calendarRef = ref<CalendarInstance | null>(null)
const lastMonthKey = ref<string | null>(null)
const currentMonth = ref<DiaryCalendarMonth | null>(null)
const { locale, t } = useI18n()
const { theme } = useTheme()

const calendarLocale = computed(() => (locale.value === 'zh' ? 'zh-CN' : 'en-US'))
const isDark = computed(() => theme.value === 'dark')
const normalizedDays = computed(() => normalizeDiaryDays(props.days))
const calendarAttributes = computed(() => diaryCalendarAttributes(normalizedDays.value))
const initialPage = computed(() => (
  diaryCalendarMonthFromPage(props.initialMonth) ?? diaryCalendarMonthFromLocalDate()
))

function onCalendarPagesUpdate(pages: unknown): void {
  const page = Array.isArray(pages) ? pages[0] : null
  const month = diaryCalendarMonthFromPage(page)
  if (!month) return

  currentMonth.value = month
  const key = `${month.year}-${String(month.month).padStart(2, '0')}`
  if (lastMonthKey.value === key) return
  lastMonthKey.value = key
  emit('month-change', month)
}

function onDayClick(day: CalendarDayLike): void {
  const date = diaryDateFromCalendarDay(day)
  if (date) emit('date-selected', date)
}

function dayAriaLabel(day: CalendarDayLike, attributes: unknown): string {
  const base = day.ariaLabel || day.label || diaryDateFromCalendarDay(day) || t('diary.calendar.day')
  return hasDiaryCalendarAttribute(attributes)
    ? `${base}, ${t('diary.calendar.has_diary')}`
    : base
}

function goToToday(): void {
  const today = localCivilToday()
  if (!today) return

  void calendarRef.value?.move(localCalendarDateForDiaryDate(today))
  emit('date-selected', today)
}
</script>

<template>
  <section
    class="diary-calendar"
    data-testid="diary-calendar"
    :data-locale="calendarLocale"
    :data-theme="isDark ? 'dark' : 'light'"
    :data-month="currentMonth ? `${currentMonth.year}-${String(currentMonth.month).padStart(2, '0')}` : undefined"
    role="region"
    :aria-label="t('diary.calendar.label')"
    :aria-busy="props.loading || undefined"
  >
    <div class="diary-calendar-host">
      <button
        type="button"
        class="diary-calendar-today"
        data-testid="diary-calendar-today"
        :aria-label="t('diary.calendar.today')"
        @click="goToToday"
      >
        {{ t('diary.calendar.today') }}
      </button>

      <Calendar
        ref="calendarRef"
        view="monthly"
        borderless
        transparent
        :initial-page="initialPage"
        :attributes="calendarAttributes"
        :locale="calendarLocale"
        :masks="{ title: 'MMMM YYYY' }"
        :is-dark="isDark"
        @dayclick="onDayClick"
        @update:pages="onCalendarPagesUpdate"
      >
        <template #header-prev-button>
          <span data-testid="diary-calendar-previous" class="diary-calendar-nav-content">
            <span aria-hidden="true">‹</span>
            <span class="diary-calendar-visually-hidden">{{ t('diary.calendar.previous_month') }}</span>
          </span>
        </template>
        <template #header-next-button>
          <span data-testid="diary-calendar-next" class="diary-calendar-nav-content">
            <span aria-hidden="true">›</span>
            <span class="diary-calendar-visually-hidden">{{ t('diary.calendar.next_month') }}</span>
          </span>
        </template>
        <template #day-content="{ day, attributes, dayProps, dayEvents }">
          <button
            v-bind="dayProps"
            v-on="dayEvents"
            type="button"
            data-diary-day-content
            :data-date="diaryDateFromCalendarDay(day) ?? undefined"
            :aria-label="dayAriaLabel(day, attributes)"
          >
            <span>{{ day.label }}</span>
            <span v-if="hasDiaryCalendarAttribute(attributes)" class="diary-calendar-visually-hidden">
              {{ t('diary.calendar.has_diary') }}
            </span>
          </button>
        </template>
      </Calendar>

      <div v-if="props.loading" class="diary-calendar-status" data-testid="diary-calendar-loading" role="status" aria-live="polite">
        {{ t('diary.calendar.loading') }}
      </div>
      <div v-if="props.error" class="diary-calendar-status diary-calendar-error" data-testid="diary-calendar-error" role="alert">
        {{ props.error }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.diary-calendar {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  max-width: none;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: var(--text);
}

.diary-calendar-host {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.diary-calendar-today {
  position: absolute;
  top: 7px;
  right: 16px;
  z-index: 3;
  min-width: 44px;
  min-height: 44px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-soft);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.diary-calendar-today:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.diary-calendar-status {
  position: absolute;
  top: 52px;
  left: 16px;
  z-index: 2;
  color: var(--text-muted);
  font-size: 0.875rem;
  pointer-events: none;
}

.diary-calendar-error {
  color: var(--vs-danger, #d73a49);
}

.diary-calendar-host :deep(.vc-container),
.diary-calendar-host :deep(.vc-pane-container),
.diary-calendar-host :deep(.vc-pane-layout),
.diary-calendar-host :deep(.vc-pane),
.diary-calendar-host :deep(.vc-weeks) {
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.diary-calendar-host :deep(.vc-container) {
  align-items: stretch;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}

.diary-calendar-host :deep(.vc-pane-container),
.diary-calendar-host :deep(.vc-pane-layout),
.diary-calendar-host :deep(.vc-pane),
.diary-calendar-host :deep(.vc-weeks) {
  flex-direction: column;
}

.diary-calendar-host :deep(.vc-header) {
  grid-template-columns: [prev] auto [title] minmax(0, 1fr) [next] auto !important;
  height: 44px;
  margin-top: 0;
  padding-left: 16px;
  padding-right: 90px;
}

/* VCalendar renders its arrow header in an absolute wrapper above the pane
   layout. Full-height flex sizing makes that stacking relationship explicit
   so the official prev/next controls remain interactive. */
.diary-calendar-host :deep(.vc-pane-header-wrapper) {
  z-index: 2;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-header) {
  position: relative;
  display: block;
  padding-left: 16px;
  padding-right: 90px;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev),
.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next) {
  position: absolute;
  top: 7px;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev) {
  left: 16px;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next) {
  right: 90px;
}

.diary-calendar-host :deep(.vc-title-wrapper) {
  max-width: calc(100% - 180px);
  justify-self: center;
  min-width: 0;
}

.diary-calendar-host :deep(.vc-title) {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.diary-calendar-host :deep(.vc-pane > .vc-header) {
  position: relative;
  padding-right: 16px;
}

.diary-calendar-host :deep(.vc-weekdays) {
  flex: 0 0 auto;
}

.diary-calendar-host :deep(.vc-week) {
  flex: 1 1 0;
  min-height: 44px;
}

.diary-calendar-host :deep(.vc-day) {
  min-height: 0;
}

.diary-calendar-host :deep(.vc-day-content) {
  height: 100%;
  min-height: 44px;
  width: 100%;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}

.diary-calendar-host :deep(.vc-arrow) {
  min-width: 40px;
  min-height: 40px;
}

.diary-calendar-host :deep(.vc-day-content:hover) {
  background: var(--bg-soft);
}

.diary-calendar-nav-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.diary-calendar-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 420px) {
  .diary-calendar-today {
    top: 4px;
    right: 8px;
    min-width: 44px;
    min-height: 44px;
    padding: 4px 7px;
  }

  .diary-calendar-host :deep(.vc-header) {
    padding-left: 4px;
    padding-right: 72px;
  }

  .diary-calendar-host :deep(.vc-title-wrapper) {
    max-width: calc(100% - 144px);
  }

  .diary-calendar-host :deep(.vc-pane > .vc-header) {
    padding-right: 4px;
  }

  .diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev) {
    left: 4px;
  }

  .diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next) {
    right: 72px;
  }

  .diary-calendar-host :deep(.vc-week) {
    flex: 0 0 auto;
    min-height: 44px;
  }

  .diary-calendar-host :deep(.vc-day-content) {
    min-height: 44px;
    height: 44px;
  }

  .diary-calendar-host :deep(.vc-weeks) {
    padding-left: 0;
    padding-right: 0;
  }

  .diary-calendar-surface-empty,
  .diary-calendar-status {
    left: 8px;
  }
}
</style>
