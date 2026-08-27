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

function moodActionLabel(day: CalendarDayLike): string {
  const date = diaryDateFromCalendarDay(day) ?? day.label ?? t('diary.calendar.day')
  return t('diary.calendar.mood_action', {
    date,
    mood: moodLabelForDay(day),
  })
}

function isValidMetadataVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function moodActionDisabled(day: CalendarDayLike): boolean {
  if (props.loading || props.moodBusy) return true
  const data = diaryDayForCalendarDay(day)
  // A missing day is a valid entry point: VaultView owns the existing
  // today/past create-or-open command after the user chooses a mood. An
  // existing file without a CAS version is not safe to mutate from here.
  return Boolean(data?.hasDiary && !isValidMetadataVersion(data.metadataUpdatedAt))
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
  const left = Math.min(Math.max(triggerRect.right - pickerWidth, inset), maxLeft)
  const belowTop = triggerRect.bottom + gap
  const aboveTop = triggerRect.top - pickerHeight - gap
  const top = belowTop > maxTop && aboveTop >= inset
    ? aboveTop
    : Math.min(Math.max(belowTop, inset), maxTop)

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

function openMoodPicker(day: CalendarDayLike, event: MouseEvent): void {
  if (moodActionDisabled(day)) return
  const date = diaryDateFromCalendarDay(day)
  const trigger = event.currentTarget
  if (!date || !(trigger instanceof HTMLButtonElement)) return

  activeMoodDate.value = date
  activeMoodTrigger.value = trigger
  moodPickerStyle.value = { top: '12px', left: '12px' }
  moodPickerOpen.value = true
  void nextTick(() => {
    moodPickerRef.value?.focusInitial()
    scheduleMoodPickerPosition()
  })
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
              :data-date="diaryDateFromCalendarDay(day) ?? undefined"
              :aria-label="dayAriaLabel(day, attributes)"
            >
              <span class="diary-calendar-day-number">{{ day.label }}</span>
              <span
                v-if="moodDefinitionForDay(day)"
                class="diary-calendar-mood-marker"
                aria-hidden="true"
              >
                <img :src="assetUrl(moodDefinitionForDay(day)!.asset)" alt="">
              </span>
              <span v-else-if="hasUnknownMoodForDay(day)" class="diary-calendar-mood-marker diary-calendar-mood-marker-unknown" aria-hidden="true">?</span>
              <span v-if="hasDiaryCalendarAttribute(attributes)" class="diary-calendar-visually-hidden">
                {{ t('diary.calendar.has_diary') }}
              </span>
              <span v-if="diaryDayForCalendarDay(day)?.mood !== undefined && diaryDayForCalendarDay(day)?.mood !== null" class="diary-calendar-visually-hidden">
                {{ t('mood.label') }}: {{ moodLabelForDay(day) }}
              </span>
            </button>
            <button
              type="button"
              class="diary-calendar-mood-action"
              data-testid="diary-calendar-mood-action"
              :data-date="diaryDateFromCalendarDay(day) ?? undefined"
              :aria-label="moodActionLabel(day)"
              aria-haspopup="dialog"
              :aria-expanded="moodPickerOpen && activeMoodDate === diaryDateFromCalendarDay(day) ? 'true' : 'false'"
              :disabled="moodActionDisabled(day)"
              @click.stop="openMoodPicker(day, $event)"
              @keydown.stop
            >
              <span aria-hidden="true">{{ moodDefinitionForDay(day) ? '✎' : '+' }}</span>
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

.diary-calendar-host :deep(.vc-day-content:hover) {
  background: var(--bg-soft);
}

.diary-calendar-day-content {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 44px;
}

.diary-calendar-day-content > [data-diary-day-content] {
  position: absolute;
  inset: 0;
}

.diary-calendar-day-number {
  position: relative;
  z-index: 1;
}

.diary-calendar-mood-marker {
  position: absolute;
  right: 9px;
  bottom: 8px;
  z-index: 1;
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.diary-calendar-mood-marker img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.diary-calendar-mood-marker-unknown {
  border: 1px solid var(--vs-text-3, #98a2b3);
  border-radius: 50%;
  color: var(--vs-text-2, #667085);
  font-size: 0.7rem;
  font-weight: 700;
}

.diary-calendar-mood-action {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--vs-text-3, #98a2b3);
  cursor: pointer;
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  opacity: 0.72;
}

.diary-calendar-mood-action:hover:not(:disabled) {
  color: var(--vs-text-1, #1b2433);
  opacity: 1;
}

.diary-calendar-mood-action:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  opacity: 1;
}

.diary-calendar-mood-action:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.diary-calendar-mood-action:disabled:focus-visible {
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
    min-height: 44px;
  }

  .diary-calendar-host :deep(.vc-day-content) {
    min-height: 44px;
    height: 44px;
  }

  .diary-calendar-day-content {
    min-height: 44px;
  }

  .diary-calendar-mood-action {
    top: 1px;
    left: 1px;
    width: 28px;
    height: 28px;
  }

  .diary-calendar-mood-marker {
    right: 1px;
    bottom: 1px;
    width: 14px;
    height: 14px;
  }

  .diary-calendar-mood-marker img {
    width: 14px;
    height: 14px;
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
