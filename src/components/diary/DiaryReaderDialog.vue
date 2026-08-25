<script setup lang="ts">
import { ref } from 'vue'
import ReadingPane from '../vault/ReadingPane.vue'
import { useI18n } from '../../composables/useI18n'
import type { Resolver as WikiResolver } from '../../lib/wikiLinks'
import type { DiaryDate } from '../../../shared/diaryProtocol'

const props = defineProps<{
  date: DiaryDate
  path: string
  raw: string
  loading?: boolean
  error?: string | null
  resolver?: WikiResolver
}>()

const emit = defineEmits<{
  close: []
  edit: []
}>()

const { t } = useI18n()
const backButton = ref<HTMLButtonElement | null>(null)
const dialog = ref<HTMLElement | null>(null)

function focusInitial(): void {
  backButton.value?.focus()
  if (document.activeElement !== backButton.value) dialog.value?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

defineExpose({ focusInitial })
</script>

<template>
  <section
    ref="dialog"
    class="diary-reader-dialog"
    data-testid="diary-reader-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="diary-reader-title"
    tabindex="-1"
    :data-path="props.path"
    @keydown="onKeydown"
  >
    <header class="diary-reader-header">
      <button
        ref="backButton"
        type="button"
        class="diary-reader-action diary-reader-back"
        data-testid="diary-reader-back"
        :aria-label="t('diary.reader.back')"
        @click="emit('close')"
      >
        <span aria-hidden="true">‹</span>
        <span>{{ t('diary.reader.back') }}</span>
      </button>

      <h2 id="diary-reader-title" class="diary-reader-title">{{ props.date }}</h2>

      <div class="diary-reader-actions">
        <button
          type="button"
          class="diary-reader-action diary-reader-edit"
          data-testid="diary-reader-edit"
          :aria-label="t('diary.reader.edit')"
          @click="emit('edit')"
        >{{ t('diary.reader.edit') }}</button>
        <button
          type="button"
          class="diary-reader-action diary-reader-close"
          data-testid="diary-reader-close"
          :aria-label="t('diary.reader.close')"
          @click="emit('close')"
        >×</button>
      </div>
    </header>

    <main class="diary-reader-body">
      <p v-if="props.loading" class="diary-reader-status" data-testid="diary-reader-loading" role="status" aria-live="polite">
        {{ t('diary.reader.loading') }}
      </p>
      <p v-else-if="props.error" class="diary-reader-status diary-reader-error" data-testid="diary-reader-error" role="alert">
        {{ props.error }}
      </p>
      <ReadingPane
        v-else
        :raw="props.raw"
        :resolver="props.resolver"
        :source-path="props.path"
      />
    </main>
  </section>
</template>

<style scoped>
.diary-reader-dialog {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--vs-bg-1, var(--bg, #fff));
  color: var(--vs-text-1, var(--text, #1f1f1f));
}

.diary-reader-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 16px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--vs-border, var(--border));
  background: var(--vs-bg-1, var(--bg, #fff));
}

.diary-reader-title {
  margin: 0;
  color: inherit;
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.25;
  text-align: center;
  white-space: nowrap;
}

.diary-reader-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
}

.diary-reader-action {
  min-width: 44px;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--vs-text-2, var(--text-muted));
  font: inherit;
  cursor: pointer;
}

.diary-reader-action:hover {
  background: var(--vs-hover-bg, var(--bg-soft));
  color: var(--vs-text-1, var(--text));
}

.diary-reader-action:focus-visible {
  outline: 2px solid var(--vs-accent, var(--accent));
  outline-offset: 2px;
}

.diary-reader-back {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.diary-reader-close {
  font-size: 1.35rem;
  line-height: 1;
}

.diary-reader-body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.diary-reader-body :deep(.reading-pane) {
  padding-top: 32px;
}

.diary-reader-status {
  margin: auto;
  color: var(--vs-text-2, var(--text-muted));
}

.diary-reader-error {
  color: var(--vs-danger, #d73a49);
}

@media (max-width: 600px) {
  .diary-reader-header {
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 4px;
    padding-left: 8px;
    padding-right: 8px;
  }

  .diary-reader-back {
    width: 44px;
    padding: 8px;
  }

  .diary-reader-back span:last-child {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
}
</style>
