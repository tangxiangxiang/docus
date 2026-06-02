import { ref, computed, readonly, onMounted, onBeforeUnmount } from 'vue'

export type Theme = 'auto' | 'light' | 'dark'

const STORAGE_KEY = 'docus.theme'
const ATTR = 'data-theme'

/** Module-level singleton state. Initialized once at module load. */
const theme = ref<Theme>(readSaved())
const systemDark = ref<boolean>(getSystemDark())

/** Single matchMedia instance, lazy (null on SSR / non-browser). */
const mq = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

function readSaved(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw
  } catch {
    /* private mode / storage blocked — fall through */
  }
  return 'auto'
}

function getSystemDark(): boolean {
  return mq ? mq.matches : false
}

function applyToDom(t: Theme) {
  const el = document.documentElement
  if (t === 'auto') el.removeAttribute(ATTR)
  else el.setAttribute(ATTR, t)
}

// Keep DOM in sync at module load — covers the case where the inline
// boot script in index.html didn't run (e.g. private mode).
applyToDom(theme.value)

const isDark = computed(() =>
  theme.value === 'dark' || (theme.value === 'auto' && systemDark.value),
)

function set(t: Theme) {
  theme.value = t
  try { localStorage.setItem(STORAGE_KEY, t) } catch { /* ignore */ }
  applyToDom(t)
}

function cycle() {
  set(theme.value === 'auto' ? 'light' : theme.value === 'light' ? 'dark' : 'auto')
}

function onSystemChange() {
  systemDark.value = mq?.matches ?? false
}

export function useTheme() {
  // Lifecycle hooks are valid here only when called from a component
  // setup(). The only caller in this app is NavBar.vue, so this is safe.
  onMounted(() => {
    mq?.addEventListener('change', onSystemChange)
  })
  onBeforeUnmount(() => {
    mq?.removeEventListener('change', onSystemChange)
  })
  return {
    theme: readonly(theme),
    isDark,
    set,
    cycle,
  }
}
