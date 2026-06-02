<script setup lang="ts">
import type { Tab } from './tabs'

defineProps<{ tabs: Tab[]; activeSlug: string | null }>()
const emit = defineEmits<{ select: [slug: string]; close: [slug: string] }>()
</script>

<template>
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
</template>
