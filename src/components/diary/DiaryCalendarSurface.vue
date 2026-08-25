<script setup lang="ts">
import { computed } from 'vue'
import type { TreeNode } from '../../lib/api'
import type { DiaryDate } from '../../../shared/diaryProtocol'
import { useI18n } from '../../composables/useI18n'
import DiaryCalendar from './DiaryCalendar.vue'
import { projectDiaryDaysFromTree } from './diaryCalendarProjection'
import type { DiaryCalendarDay, DiaryCalendarMonth } from './diaryCalendarAdapter'

const props = withDefaults(defineProps<{
  tree: readonly TreeNode[]
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

const { t } = useI18n()
const days = computed<DiaryCalendarDay[]>(() => projectDiaryDaysFromTree(props.tree))
</script>

<template>
  <section
    class="diary-calendar-surface"
    data-testid="diary-calendar-surface"
    role="region"
    :aria-label="t('diary.surface.label')"
    :aria-busy="props.loading || undefined"
  >
    <p
      v-if="!props.loading && !props.error && days.length === 0"
      class="diary-calendar-surface-empty"
      data-testid="diary-calendar-surface-empty"
      role="status"
      aria-live="polite"
    >
      {{ t('diary.surface.empty') }}
    </p>

    <DiaryCalendar
      :days="days"
      :loading="props.loading"
      :error="props.error"
      :initial-month="props.initialMonth"
      @date-selected="emit('date-selected', $event)"
      @month-change="emit('month-change', $event)"
    />
  </section>
</template>

<style scoped>
.diary-calendar-surface {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  background: var(--vs-bg-1, var(--bg, #fff));
  color: var(--vs-text-1, var(--text, #1f1f1f));
}

.diary-calendar-surface-empty {
  position: absolute;
  top: 52px;
  left: 16px;
  z-index: 2;
  margin: 0;
  color: var(--vs-text-2, var(--text-muted, #6b6b6b));
  font-size: 0.875rem;
  pointer-events: none;
}
</style>
