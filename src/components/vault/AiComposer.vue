<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ICON_SEND, ICON_STOP } from './icons'
import { useI18n } from '../../composables/useI18n'

const props = withDefaults(defineProps<{
  modelValue: string
  busy: boolean
  configured: boolean
  contextPaths: string[]
  canAddContext: boolean
  contextPickerOpen: boolean
}>(), {
  contextPaths: () => [],
  canAddContext: true,
  contextPickerOpen: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: []
  stop: []
  'remove-context': [path: string]
  'toggle-context-picker': []
}>()
const { t } = useI18n()

const inputPlaceholder = computed(
  () => `${t('ai.input_placeholder')} · ${t('ai.keyboard_hint')}`,
)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const INPUT_MAX_H = 160

function autoresize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  const natural = el.scrollHeight
  el.style.height = Math.min(natural, INPUT_MAX_H) + 'px'
  el.style.overflowY = natural > INPUT_MAX_H ? 'auto' : 'hidden'
}

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  autoresize()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  emit('send')
}

function onPrimaryAction() {
  if (props.busy) emit('stop')
  else emit('send')
}

async function focus() {
  await nextTick()
  inputEl.value?.focus()
}

watch(() => props.modelValue, () => nextTick(autoresize))
onMounted(autoresize)
defineExpose({ focus })
</script>

<template>
  <form class="ai-composer" @submit.prevent="emit('send')">
    <div class="ai-composer-card">
      <div v-if="contextPaths.length" class="ai-context-paths" :aria-label="t('ai.attached_context')">
        <span v-for="path in contextPaths" :key="path" class="ai-context-chip" :title="path">
          <span class="ai-context-chip-path">{{ path }}</span>
          <button
            class="ai-context-chip-remove"
            type="button"
            :aria-label="t('ai.remove_context')"
            @click="emit('remove-context', path)"
          >×</button>
        </span>
      </div>
      <textarea
        ref="inputEl"
        :value="modelValue"
        class="ai-input"
        rows="1"
        :placeholder="inputPlaceholder"
        :aria-label="t('ai.input_placeholder')"
        @keydown="onKeydown"
        @input="onInput"
      />
      <div class="ai-toolbar">
        <div class="ai-toolbar-left">
          <button
            class="ai-tool-button"
            type="button"
            :title="t('ai.add_context')"
            :aria-label="t('ai.add_context')"
            :disabled="!canAddContext"
            :aria-expanded="contextPickerOpen"
            aria-haspopup="listbox"
            @click="emit('toggle-context-picker')"
          >
            <span class="ai-tool-plus">+</span>
          </button>
          <span class="ai-mode-badge" aria-hidden="true">
            <span class="ai-mode-dot" />
            Auto
          </span>
        </div>
        <div class="ai-toolbar-right">
          <button
            class="ai-send"
            :class="{ 'ai-send-busy': busy }"
            type="button"
            :title="t(busy ? 'ai.stop' : 'ai.send_hint')"
            :aria-label="t(busy ? 'ai.stop' : 'ai.send')"
            :disabled="!busy && (!modelValue.trim() || !configured)"
            @click="onPrimaryAction"
          >
            <span class="ai-send-icon" v-html="busy ? ICON_STOP : ICON_SEND" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </form>
</template>
