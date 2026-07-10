<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { ICON_FILE_MD } from './icons'

const props = defineProps<{
  modelValue: string
  busy: boolean
  configured: boolean
  currentPath: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: []
  stop: []
}>()

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
  emit(props.busy ? 'stop' : 'send')
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
      <textarea
        ref="inputEl"
        :value="modelValue"
        class="ai-input"
        rows="1"
        placeholder="Ask Claude…"
        aria-label="Ask Claude"
        @keydown="onKeydown"
        @input="onInput"
      />
      <div class="ai-toolbar">
        <div class="ai-toolbar-left">
          <span v-if="currentPath" class="ai-context" :title="currentPath">
            <span class="ai-context-icon" v-html="ICON_FILE_MD" aria-hidden="true" />
            <span class="ai-context-path">{{ currentPath }}</span>
          </span>
          <span v-else class="ai-context ai-context-empty">no document</span>
        </div>
        <div class="ai-toolbar-right">
          <button
            class="ai-send"
            :class="{ 'ai-send-busy': busy }"
            type="button"
            :title="busy ? 'Stop' : 'Send (Enter)'"
            :aria-label="busy ? 'Stop' : 'Send'"
            :disabled="!busy && (!modelValue.trim() || !configured)"
            @click="onPrimaryAction"
          >{{ busy ? '■' : '↑' }}</button>
        </div>
      </div>
    </div>
  </form>
</template>
