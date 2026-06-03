<script setup lang="ts">
import type { Tab } from './tabs'

defineProps<{ tabs: Tab[]; activePath: string | null }>()
const emit = defineEmits<{ select: [path: string]; close: [path: string] }>()
</script>

<template>
  <div class="tabs" role="tablist">
    <div
      v-for="t in tabs"
      :key="t.path"
      role="tab"
      :aria-selected="t.path === activePath"
      class="tab"
      :class="{ active: t.path === activePath }"
      @click="emit('select', t.path)"
      @auxclick.middle="emit('close', t.path)"
    >
      <span class="tab-dot" :class="{ dirty: t.saveStatus === 'dirty' }" />
      <span class="tab-title">{{ t.title || t.path }}</span>
      <button
        v-if="tabs.length > 0"
        class="tab-close"
        title="Close"
        @click.stop="emit('close', t.path)"
      >×</button>
    </div>
  </div>
</template>
