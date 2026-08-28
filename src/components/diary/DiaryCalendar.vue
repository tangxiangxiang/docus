<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Calendar } from 'v-calendar'
import 'v-calendar/style.css'
import { getMoodDefinition, isMoodId, type MoodId } from '../../../shared/diaryMood'
import { useI18n } from '../../composables/useI18n'
import { useTheme } from '../../composables/useTheme'
import type { DiaryDate } from '../../../shared/diaryProtocol'
import DiaryMoodPicker from './DiaryMoodPicker.vue'
import {
  diaryCalendarAttributes,
  diaryCalendarMonthFromLocalDate,
  diaryCalendarMonthFromPage,
  diaryDateFromCalendarDay,
  hasDiaryCalendarAttribute,
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

const props = withDefaults(defineProps<{
  days: readonly DiaryCalendarDay[]
  loading?: boolean
  error?: string | null
  initialMonth?: DiaryCalendarMonth
  moodBusy?: boolean
}>(), {
  loading: false,
  error: null,
  moodBusy: false,
})

const emit = defineEmits<{
  'date-selected': [date: DiaryDate]
  'month-change': [month: DiaryCalendarMonth]
  'mood-change': [date: DiaryDate, mood: MoodId | null]
}>()

const lastMonthKey = ref<string | null>(null)
const currentMonth = ref<DiaryCalendarMonth | null>(null)
const calendarRoot = ref<HTMLElement | null>(null)
const moodPickerOpen = ref(false)
const activeMoodDate = ref<DiaryDate | null>(null)
const activeMoodTrigger = ref<HTMLButtonElement | null>(null)
const moodPickerRef = ref<InstanceType<typeof DiaryMoodPicker> | null>(null)
const moodPickerStyle = ref<Record<string, string>>({ top: '12px', left: '12px' })
let moodPickerPositionFrame: number | null = null
const { locale, t } = useI18n()
const { theme } = useTheme()

const calendarLocale = computed(() => (locale.value === 'zh' ? 'zh-CN' : 'en-US'))
const isDark = computed(() => theme.value === 'dark')
const normalizedDays = computed(() => normalizeDiaryDays(props.days))
const calendarAttributes = computed(() => diaryCalendarAttributes(normalizedDays.value))
const daysByDate = computed(() => new Map(
  normalizedDays.value.map((day) => [day.date, day] as const),
))
const activeMoodDay = computed(() => (
  activeMoodDate.value ? daysByDate.value.get(activeMoodDate.value) ?? null : null
))
const activeMood = computed<string | null>(() => activeMoodDay.value?.mood ?? null)
const initialPage = computed(() => (
  diaryCalendarMonthFromPage(props.initialMonth) ?? diaryCalendarMonthFromLocalDate()
))

function assetUrl(asset: string): string {
  return asset.startsWith('public/') ? `/${asset.slice('public/'.length)}` : asset
}

function diaryDayForCalendarDay(day: CalendarDayLike): DiaryCalendarDay | null {
  const date = diaryDateFromCalendarDay(day)
  return date ? daysByDate.value.get(date) ?? null : null
}

function moodDefinitionForDay(day: CalendarDayLike) {
  const mood = diaryDayForCalendarDay(day)?.mood
  return typeof mood === 'string' && isMoodId(mood) ? getMoodDefinition(mood) ?? null : null
}

function hasUnknownMoodForDay(day: CalendarDayLike): boolean {
  const mood = diaryDayForCalendarDay(day)?.mood
  return typeof mood === 'string' && !isMoodId(mood)
}

function moodLabelForDay(day: CalendarDayLike): string {
  const mood = diaryDayForCalendarDay(day)?.mood
  if (typeof mood === 'string' && isMoodId(mood)) {
    const definition = getMoodDefinition(mood)
    if (definition) return locale.value === 'zh' ? definition.zhLabel : definition.enLabel
  }
  return typeof mood === 'string' ? t('mood.unknown') : t('mood.not_set')
}

function moodButtonLabel(day: CalendarDayLike): string {
  const date = diaryDateFromCalendarDay(day) ?? day.label ?? t('diary.calendar.day')
  return t('diary.calendar.mood_action', {
    date,
    mood: moodLabelForDay(day),
  })
}

function isValidMetadataVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function moodButtonDisabled(day: CalendarDayLike): boolean {
  if (props.loading || props.moodBusy) return true
  const data = diaryDayForCalendarDay(day)
  // Existing files without a CAS version are not safe to mutate from the
  // Calendar. Missing today/past dates enter through the date button's
  // Mood-first flow and obtain fresh CAS only after canonical creation.
  return Boolean(data?.hasDiary && !isValidMetadataVersion(data.metadataUpdatedAt))
}

function hasDiaryForDay(day: CalendarDayLike): boolean {
  return diaryDayForCalendarDay(day)?.hasDiary === true
}

function pickerElement(): HTMLElement | null {
  const element = moodPickerRef.value?.$el
  return element instanceof HTMLElement ? element : null
}

function updateMoodPickerPosition(): void {
  if (!moodPickerOpen.value) return
  const trigger = activeMoodTrigger.value
  const picker = pickerElement()
  if (!trigger || !picker) return

  const triggerRect = trigger.getBoundingClientRect()
  const pickerRect = picker.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const inset = 12
  const gap = 8
  const pickerWidth = pickerRect.width || picker.offsetWidth
  const pickerHeight = pickerRect.height || picker.offsetHeight
  const maxLeft = Math.max(inset, viewportWidth - pickerWidth - inset)
  const maxTop = Math.max(inset, viewportHeight - pickerHeight - inset)
  const calendarHeaderClearance = Math.min(64, maxTop)
  const belowTop = triggerRect.bottom + gap
  const aboveTop = triggerRect.top - pickerHeight - gap
  const canPlaceBelow = belowTop <= maxTop
  const canPlaceAbove = aboveTop >= calendarHeaderClearance
  let left = Math.min(Math.max(triggerRect.right - pickerWidth, inset), maxLeft)
  let top: number

  if (canPlaceBelow) {
    top = belowTop
  } else if (canPlaceAbove) {
    top = aboveTop
  } else {
    // Short viewports may not have enough vertical room above or below a
    // day cell. Prefer a side placement so the picker does not cover the
    // month title/navigation controls that remain valid outside targets.
    const rightLeft = triggerRect.right + gap
    const leftLeft = triggerRect.left - pickerWidth - gap
    left = rightLeft + pickerWidth <= viewportWidth - inset
      ? rightLeft
      : leftLeft >= inset
        ? leftLeft
        : left
    top = Math.min(
      Math.max(triggerRect.top + (triggerRect.height - pickerHeight) / 2, calendarHeaderClearance),
      maxTop,
    )
  }

  moodPickerStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  }
}

function scheduleMoodPickerPosition(): void {
  if (!moodPickerOpen.value) return
  void nextTick(() => {
    if (!moodPickerOpen.value) return
    if (moodPickerPositionFrame !== null) window.cancelAnimationFrame(moodPickerPositionFrame)
    if (typeof window.requestAnimationFrame === 'function') {
      moodPickerPositionFrame = window.requestAnimationFrame(() => {
        moodPickerPositionFrame = null
        updateMoodPickerPosition()
      })
    } else {
      updateMoodPickerPosition()
    }
  })
}

function closeMoodPicker(restoreFocus = true): void {
  if (!moodPickerOpen.value) return
  const trigger = activeMoodTrigger.value
  moodPickerOpen.value = false
  activeMoodDate.value = null
  activeMoodTrigger.value = null
  moodPickerStyle.value = { top: '12px', left: '12px' }
  if (restoreFocus) void nextTick(() => trigger?.focus())
}

function openMoodPickerForDate(date: DiaryDate, trigger: HTMLButtonElement): void {
  activeMoodDate.value = date
  activeMoodTrigger.value = trigger
  moodPickerStyle.value = { top: '12px', left: '12px' }
  moodPickerOpen.value = true
  void nextTick(() => {
    moodPickerRef.value?.focusInitial()
    scheduleMoodPickerPosition()
  })
}

function openMoodPicker(day: CalendarDayLike, event: MouseEvent): void {
  if (moodButtonDisabled(day)) return
  const date = diaryDateFromCalendarDay(day)
  const trigger = event.currentTarget
  if (!date || !(trigger instanceof HTMLButtonElement)) return

  openMoodPickerForDate(date, trigger)
}

function emitMoodChange(mood: MoodId | null): void {
  if (activeMoodDate.value) emit('mood-change', activeMoodDate.value, mood)
}

function isCalendarContextTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('[data-diary-day-content], .vc-prev, .vc-next, .vc-title'))
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target
  const picker = pickerElement()
  if (!moodPickerOpen.value || !(target instanceof Node) || picker?.contains(target)) return

  // A date/header navigation target is a new Calendar context even though it
  // lives inside the keep-mounted Calendar root. Close at pointerdown so the
  // picker cannot retain its old date while the subsequent click navigates.
  if (isCalendarContextTarget(target)) {
    closeMoodPicker(false)
    return
  }

  if (!calendarRoot.value?.contains(target)) closeMoodPicker(false)
}

function onCalendarPagesUpdate(pages: unknown): void {
  const page = Array.isArray(pages) ? pages[0] : null
  const month = diaryCalendarMonthFromPage(page)
  if (!month) return

  const key = `${month.year}-${String(month.month).padStart(2, '0')}`
  if (lastMonthKey.value === key) return
  // A page change is a new Calendar context. Do not let a body-teleported
  // picker continue editing the date from the previous month.
  closeMoodPicker(false)
  currentMonth.value = month
  lastMonthKey.value = key
  emit('month-change', month)
}

function onDayClick(day: CalendarDayLike): void {
  const date = diaryDateFromCalendarDay(day)
  if (!date) return

  // A missing today/past Diary requires a Mood choice before the existing
  // date command may create it. Opening and dismissing this picker is purely
  // presentational and therefore cannot create a document. Missing future
  // dates continue through the existing command so its guard remains the
  // single authority for the browser-visible no-op.
  const today = localCivilToday()
  if (!hasDiaryForDay(day) && today && date <= today) {
    const trigger = calendarRoot.value?.querySelector<HTMLButtonElement>(
      `[data-diary-day-content][data-date="${date}"]`,
    )
    if (trigger) openMoodPickerForDate(date, trigger)
    return
  }

  // Date navigation leaves the current Mood picker context. The parent may
  // keep Calendar mounted while the native document surface takes over, so
  // close without restoring focus to the soon-to-be-hidden trigger.
  closeMoodPicker(false)
  emit('date-selected', date)
}

function dayAriaLabel(day: CalendarDayLike, attributes: unknown): string {
  const base = day.ariaLabel || day.label || diaryDateFromCalendarDay(day) || t('diary.calendar.day')
  const data = diaryDayForCalendarDay(day)
  const labels: string[] = []
  if (hasDiaryCalendarAttribute(attributes) || data?.hasDiary) labels.push(t('diary.calendar.has_diary'))
  if (data && typeof data.mood === 'string') labels.push(`${t('mood.label')}: ${moodLabelForDay(day)}`)
  return labels.length ? `${base}, ${labels.join(', ')}` : base
}

function focusDate(date: DiaryDate): boolean {
  const target = calendarRoot.value?.querySelector<HTMLElement>(
    `[data-diary-day-content][data-date="${date}"]`,
  )
  if (!target) return false
  target.focus()
  return document.activeElement === target
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('resize', scheduleMoodPickerPosition)
  window.addEventListener('scroll', scheduleMoodPickerPosition, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('resize', scheduleMoodPickerPosition)
  window.removeEventListener('scroll', scheduleMoodPickerPosition, true)
  if (moodPickerPositionFrame !== null) window.cancelAnimationFrame(moodPickerPositionFrame)
})

defineExpose({ focusDate, closeMoodPicker })

</script>

<template>
  <section
    ref="calendarRoot"
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
      <Calendar
        view="monthly"
        borderless
        transparent
        :initial-page="initialPage"
        :attributes="calendarAttributes"
        :locale="calendarLocale"
            :masks="{ title: 'YYYY-MM' }"
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
          <div class="diary-calendar-day-content">
            <button
              v-bind="dayProps"
              v-on="dayEvents"
              type="button"
              data-diary-day-content
              :class="{ 'has-mood': moodDefinitionForDay(day) || hasUnknownMoodForDay(day) }"
              :data-date="diaryDateFromCalendarDay(day) ?? undefined"
              :aria-label="dayAriaLabel(day, attributes)"
            >
              <span class="diary-calendar-day-number">{{ day.label }}</span>
              <span v-if="hasDiaryCalendarAttribute(attributes)" class="diary-calendar-visually-hidden">
                {{ t('diary.calendar.has_diary') }}
              </span>
              <span v-if="diaryDayForCalendarDay(day)?.mood !== undefined && diaryDayForCalendarDay(day)?.mood !== null" class="diary-calendar-visually-hidden">
                {{ t('mood.label') }}: {{ moodLabelForDay(day) }}
              </span>
            </button>
            <button
              v-if="hasDiaryCalendarAttribute(attributes) || moodDefinitionForDay(day) || hasUnknownMoodForDay(day)"
              type="button"
              class="diary-calendar-mood"
              :class="{
                'diary-calendar-mood-unknown': hasUnknownMoodForDay(day),
                'diary-calendar-mood-empty': !moodDefinitionForDay(day) && !hasUnknownMoodForDay(day),
              }"
              data-testid="diary-calendar-mood"
              :data-date="diaryDateFromCalendarDay(day) ?? undefined"
              :aria-label="moodButtonLabel(day)"
              :aria-expanded="moodPickerOpen && activeMoodDate === diaryDateFromCalendarDay(day) ? 'true' : 'false'"
              :aria-controls="moodPickerOpen && activeMoodDate === diaryDateFromCalendarDay(day) ? 'diary-mood-picker' : undefined"
              :disabled="moodButtonDisabled(day)"
              @click.stop="openMoodPicker(day, $event)"
              @keydown.stop
            >
              <img
                v-if="moodDefinitionForDay(day)"
                :src="assetUrl(moodDefinitionForDay(day)!.asset)"
                alt=""
                aria-hidden="true"
              >
              <span v-else-if="hasUnknownMoodForDay(day)" aria-hidden="true">?</span>
              <span v-else class="diary-calendar-mood-empty-mark" aria-hidden="true">?</span>
            </button>
          </div>
        </template>
      </Calendar>

      <div v-if="props.loading" class="diary-calendar-status" data-testid="diary-calendar-loading" role="status" aria-live="polite">
        {{ t('diary.calendar.loading') }}
      </div>
      <div v-if="props.error" class="diary-calendar-status diary-calendar-error" data-testid="diary-calendar-error" role="alert">
        {{ props.error }}
      </div>
    </div>

    <Teleport to="body">
      <DiaryMoodPicker
        v-if="moodPickerOpen"
        ref="moodPickerRef"
        :style="moodPickerStyle"
        :current-mood="activeMood"
        :busy="props.moodBusy"
        @select="emitMoodChange"
        @clear="emitMoodChange(null)"
        @close="closeMoodPicker"
      />
    </Teleport>
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
  padding-top: 8px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
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
  padding-right: 16px;
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
  height: 44px;
  padding-left: 16px;
  padding-right: 16px;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev),
.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next) {
  position: absolute;
  top: 7px;
  width: 44px;
  height: 44px;
  min-width: 44px;
  max-width: 44px;
  min-height: 44px;
  max-height: 44px;
  box-sizing: border-box;
  display: flex;
  flex: 0 0 44px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  transform: none;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev) {
  left: 16px;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next) {
  right: 16px;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev:hover),
.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next:hover) {
  background: transparent;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev:focus),
.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next:focus),
.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev:active),
.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next:active) {
  background: transparent;
  border: 0;
  outline: none;
  box-shadow: none;
}

.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev:focus-visible),
.diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.diary-calendar-host :deep(.vc-title-wrapper) {
  max-width: calc(100% - 96px);
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

.diary-calendar-host :deep(.vc-day-content:hover),
.diary-calendar-host :deep(.vc-day-content:focus),
.diary-calendar-host :deep(.vc-day-content:active),
.diary-calendar-host :deep(.vc-day-content[aria-selected='true']) {
  background: transparent;
  box-shadow: none;
}

.diary-calendar-host :deep(.vc-dot) {
  display: none;
}

.diary-calendar-day-content {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 44px;
}

.diary-calendar-day-content > [data-diary-day-content] {
  position: absolute;
  top: calc(50% - 18px);
  left: 50%;
  width: 36px;
  height: 36px;
  padding: 0;
  transform: translate(-50%, -50%);
  border: 0;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
}

.diary-calendar-day-content > [data-diary-day-content]:focus {
  outline: none;
}

.diary-calendar-day-number {
  display: inline-block;
  position: relative;
  z-index: 1;
}

.diary-calendar-mood {
  position: absolute;
  left: 50%;
  top: calc(50% + 18px);
  z-index: 2;
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--vs-text-2, #667085);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
}

.diary-calendar-mood img {
  width: 21px;
  height: 21px;
  object-fit: contain;
}

.diary-calendar-mood-empty-mark {
  font-size: 1rem;
  font-weight: 500;
}

.diary-calendar-mood:hover:not(:disabled),
.diary-calendar-mood:focus,
.diary-calendar-mood:active {
  border: 0;
  background: transparent;
  outline: none;
  box-shadow: none;
}

.diary-calendar-mood:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.diary-calendar-mood:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.diary-calendar-mood:disabled:focus-visible {
  outline: none;
}

/* VCalendar's day-content rule removes the browser outline. The custom
   day button is the actual keyboard target, so restore the same visible
   focus treatment used by the month controls without changing mouse focus. */
.diary-calendar-host :deep([data-diary-day-content]:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.diary-calendar-nav-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

@media (min-width: 769px) {
  .diary-calendar-host :deep(.vc-pane-header-wrapper) {
    inset: 0;
    height: 100%;
  }

  .diary-calendar-host :deep(.vc-pane-header-wrapper .vc-header) {
    height: 100%;
    padding: 0;
  }

  .diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev),
  .diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next) {
    /* Keep month paging attached to the centered month title. */
    top: 16px;
    transform: translateY(-50%);
  }

  .diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev) {
    left: auto;
    right: calc(50% + 40px);
  }

  .diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next) {
    left: calc(50% + 40px);
    right: auto;
  }

  .diary-calendar-host :deep(.vc-title-wrapper) {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: max-content;
    max-width: calc(100% - 128px);
  }
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
  .diary-calendar-host :deep(.vc-header) {
    padding-left: 4px;
    padding-right: 4px;
  }

  .diary-calendar-host :deep(.vc-title-wrapper) {
    max-width: calc(100% - 72px);
  }

  .diary-calendar-host :deep(.vc-pane > .vc-header) {
    padding-right: 4px;
  }

  .diary-calendar-host :deep(.vc-pane-header-wrapper .vc-prev) {
    left: 4px;
  }

  .diary-calendar-host :deep(.vc-pane-header-wrapper .vc-next) {
    right: 4px;
  }

  .diary-calendar-host :deep(.vc-week) {
    flex: 0 0 auto;
    /* The date target and the optional Mood target share each day cell.
       Keep enough row height for both hit areas so the Mood control cannot
       enter the following week's date targets on narrow viewports. */
    min-height: 72px;
  }

  .diary-calendar-host :deep(.vc-day-content) {
    min-height: 44px;
    height: 44px;
  }

  .diary-calendar-day-content {
    min-height: 72px;
  }

  .diary-calendar-mood {
    top: calc(50% + 18px);
    width: 24px;
    height: 24px;
  }

  .diary-calendar-mood img {
    width: 18px;
    height: 18px;
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
