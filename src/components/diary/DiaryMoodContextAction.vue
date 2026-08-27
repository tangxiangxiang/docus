<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { getMoodDefinition, isMoodId, type MoodId } from '../../../shared/diaryMood'
import { useI18n } from '../../composables/useI18n'
import DiaryMoodPicker from './DiaryMoodPicker.vue'

const props = withDefaults(defineProps<{
  currentMood?: string | null
  busy?: boolean
  disabled?: boolean
}>(), {
  currentMood: null,
  busy: false,
  disabled: false,
})

const emit = defineEmits<{
  select: [mood: MoodId]
  clear: []
}>()

const { locale, t } = useI18n()
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const pickerRef = ref<InstanceType<typeof DiaryMoodPicker> | null>(null)
const open = ref(false)

const currentDefinition = computed(() => (
  isMoodId(props.currentMood) ? getMoodDefinition(props.currentMood) ?? null : null
))
const currentLabel = computed(() => {
  if (currentDefinition.value) {
    return locale.value === 'zh'
      ? currentDefinition.value.zhLabel
      : currentDefinition.value.enLabel
  }
  return props.currentMood === null ? t('mood.not_set') : t('mood.unknown')
})
const triggerLabel = computed(() => t('mood.trigger', { mood: currentLabel.value }))

function assetUrl(asset: string): string {
  return asset.startsWith('public/') ? `/${asset.slice('public/'.length)}` : asset
}

function closePicker(): void {
  if (!open.value) return
  open.value = false
  void nextTick(() => triggerRef.value?.focus())
}

function openPicker(): void {
  if (props.disabled) return
  open.value = true
  void nextTick(() => pickerRef.value?.focusInitial())
}

function togglePicker(): void {
  if (open.value) closePicker()
  else openPicker()
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target
  if (open.value && target instanceof Node && !rootRef.value?.contains(target)) closePicker()
}

function focusTrigger(): void {
  triggerRef.value?.focus()
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true))

defineExpose({ close: closePicker, focusTrigger })
</script>

<template>
  <div ref="rootRef" class="diary-mood-context" data-testid="diary-native-mood-context">
    <button
      ref="triggerRef"
      type="button"
      class="diary-mood-trigger"
      data-testid="diary-mood-trigger"
      :aria-label="triggerLabel"
      aria-haspopup="true"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-busy="props.busy ? 'true' : undefined"
      :disabled="props.disabled"
      @click="togglePicker"
    >
      <img
        v-if="currentDefinition"
        :src="assetUrl(currentDefinition.asset)"
        alt=""
        aria-hidden="true"
      >
      <span v-else class="diary-mood-trigger-empty" aria-hidden="true">○</span>
      <span class="diary-mood-trigger-label">{{ currentLabel }}</span>
    </button>

    <DiaryMoodPicker
      v-if="open"
      ref="pickerRef"
      :current-mood="props.currentMood"
      :busy="props.busy"
      @select="emit('select', $event)"
      @clear="emit('clear')"
      @close="closePicker"
    />
  </div>
</template>

<style scoped>
.diary-mood-context {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}

.diary-mood-trigger {
  display: inline-flex;
  min-width: 0;
  height: 30px;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--vs-text-2, #667085);
  cursor: pointer;
  font: inherit;
  font-size: 0.76rem;
}

.diary-mood-trigger:hover:not(:disabled) {
  background: var(--vs-hover-bg, rgb(80 90 110 / 8%));
  color: var(--vs-text-1, #1b2433);
}

.diary-mood-trigger:focus-visible {
  outline: 2px solid var(--vs-accent, #4f6fff);
  outline-offset: 2px;
}

.diary-mood-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.diary-mood-trigger img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.diary-mood-trigger-empty {
  width: 20px;
  color: var(--vs-text-3, #98a2b3);
  font-size: 1.05rem;
  line-height: 1;
  text-align: center;
}

.diary-mood-trigger-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diary-mood-context :deep(.diary-mood-picker) {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  right: 0;
}
</style>
