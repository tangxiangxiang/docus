<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useTheme, type Theme } from '../composables/useTheme'

defineProps<{ isVault?: boolean }>()
const emit = defineEmits<{
  'open-search': []
}>()

const { theme, cycle } = useTheme()

/* Per-state icon + tooltip. The icon reflects the CURRENT theme;
   the title hints at the next click action. */
const themeIcon = computed<'sun' | 'moon' | 'sun-moon'>(() => {
  if (theme.value === 'light') return 'moon'   // currently light → next click is dark
  if (theme.value === 'dark') return 'sun'    // currently dark  → next click is auto
  return 'sun-moon'                            // currently auto  → next click is light
})

const themeTitle = computed<string>(() => {
  const next = nextLabel(theme.value)
  return `Theme: ${label(theme.value)} (click for ${next})`
})

function label(t: Theme): string {
  return t === 'auto' ? 'System (auto)' : t === 'light' ? 'Light' : 'Dark'
}
function nextLabel(t: Theme): string {
  return t === 'auto' ? 'Light' : t === 'light' ? 'Dark' : 'System'
}
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
      <button
        class="theme-toggle"
        type="button"
        :title="themeTitle"
        :aria-label="themeTitle"
        @click="cycle"
      >
        <!-- auto: half-sun + half-moon (SunMoon) -->
        <svg v-if="themeIcon === 'sun-moon'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4" />
          <path d="M12 2v2" />
          <path d="m19 5 1.5 1.5" />
          <path d="M22 12h-2" />
          <path d="m19 19-1.5-1.5" />
          <path d="M22 14v-2" />
        </svg>
        <!-- light: moon (currently light, click → dark) -->
        <svg v-else-if="themeIcon === 'moon'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <!-- dark: sun (currently dark, click → auto) -->
        <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </button>
    </div>
  </header>
</template>
