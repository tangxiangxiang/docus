<script setup lang="ts">
import { RouterLink } from 'vue-router'

defineProps<{ isVault?: boolean }>()
const emit = defineEmits<{
  'open-search': []
}>()
</script>

<template>
  <header :class="['navbar', { 'is-vault': isVault }]">
    <div :class="['navbar-inner', { container: !isVault, 'full-width': isVault }]">
      <RouterLink to="/" class="brand">
        <span class="brand-dot" />
        <span class="brand-name">docus</span>
      </RouterLink>
      <div class="nav-spacer" />
      <button
        v-if="isVault"
        class="nav-search"
        type="button"
        title="Search (Ctrl/Cmd+P)"
        aria-label="Search"
        @click="emit('open-search')"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="20" y1="20" x2="16.5" y2="16.5" />
        </svg>
      </button>
      <button class="theme-toggle" type="button" title="Theme (placeholder)" aria-label="Toggle theme">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </button>
    </div>
  </header>
</template>
