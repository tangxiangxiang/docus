<script setup lang="ts">
import type { Tab } from './tabs'

defineProps<{ tabs: Tab[]; activeSlug: string | null }>()
const emit = defineEmits<{
  select: [slug: string]
  close: [slug: string]
  'open-search': []
}>()
</script>

<template>
  <div class="tabs-row">
    <div class="tabs" role="tablist">
      <div
        v-for="t in tabs"
        :key="t.slug"
        role="tab"
        :aria-selected="t.slug === activeSlug"
        class="tab"
        :class="{ active: t.slug === activeSlug }"
        @click="emit('select', t.slug)"
        @auxclick.middle="emit('close', t.slug)"
      >
        <span class="tab-dot" :class="{ dirty: t.saveStatus === 'dirty' }" />
        <span class="tab-title">{{ t.title || t.slug }}</span>
        <button
          v-if="tabs.length > 0"
          class="tab-close"
          title="Close"
          @click.stop="emit('close', t.slug)"
        >×</button>
      </div>
    </div>
    <button
      class="tabs-search"
      title="Search (Ctrl/Cmd+P)"
      aria-label="Search"
      @click="emit('open-search')"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16.5" y2="16.5" />
      </svg>
    </button>
  </div>
</template>
