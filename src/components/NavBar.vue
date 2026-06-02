<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useTheme } from '../composables/useTheme'

defineProps<{ isVault?: boolean }>()
const emit = defineEmits<{
  'open-search': []
}>()

const { theme, toggle } = useTheme()

/* Sun when current theme is dark (click to lighten),
   moon when current theme is light (click to darken). */
const themeIcon = computed<'sun' | 'moon'>(() => (theme.value === 'dark' ? 'sun' : 'moon'))

const themeTitle = computed<string>(() => {
  const next = theme.value === 'dark' ? 'Light' : 'Dark'
  const cur = theme.value === 'dark' ? 'Dark' : 'Light'
  return `Theme: ${cur} (click for ${next})`
})
</script>

<template>
  <header :class="['navbar', { 'is-vault': isVault }]">
    <div :class="['navbar-inner', { container: !isVault, 'full-width': isVault }]">
      <RouterLink to="/" class="brand">
        <img class="brand-logo" src="/public/logo.svg" alt="docus logo" width="24" height="24" />
        <span class="brand-name">docus</span>
      </RouterLink>
      <div class="nav-spacer" />
      <div class="nav-actions">
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
        <button
          class="theme-toggle"
          type="button"
          :title="themeTitle"
          :aria-label="themeTitle"
          @click="toggle"
        >
        <!-- dark theme: sun (click to switch to light) -->
        <svg v-if="themeIcon === 'sun'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <!-- light theme: moon (click to switch to dark) -->
        <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
      </div>
    </div>
  </header>
</template>
