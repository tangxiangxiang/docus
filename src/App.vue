<script setup lang="ts">
import { computed, provide, ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import NavBar from './components/NavBar.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmHost from './components/ConfirmHost.vue'
import PromptHost from './components/PromptHost.vue'
import { VaultViewModeKey, type VaultViewMode } from './composables/vault/viewMode'

const route = useRoute()
/* Vault routes AND dev previews both set `fullWidth: true` so the
   navbar sits at its shorter height. But only vault routes should
   lock the outer scroll — the dev previews (/__icon-preview,
   /__markdown-test, /__editor-test) are standalone pages that
   need to scroll vertically through their full content. The
   `/__` path prefix is the marker; adding new dev previews
   under that prefix automatically inherits the correct behavior. */
const isVault = computed(() =>
  route.meta.fullWidth === true && !route.path.startsWith('/__'),
)

/* The vault uses an internal scrollable surface (FileTree, Editor,
   Preview). It must NOT let the outer document scroll, otherwise
   two scrollbars fight and the page wobbles. We toggle a body
   class on route change so the lock applies only to vault routes. */
watchEffect(() => {
  document.body.classList.toggle('vault-mode', isVault.value)
})

/* Global open-search trigger: incremented by NavBar, watched by the
   vault view to open the CommandPalette. Lives in App so a button in
   the chrome (outside the router view) can reach the vault. */
const openSearchTick = ref(0)
function onOpenSearch() { openSearchTick.value++ }
provide('openSearch', { tick: openSearchTick, trigger: onOpenSearch })

/* View mode for the vault (edit vs read). Persisted to localStorage so
   the user's preference survives reloads. Defaults to 'edit' — the
   current split-pane authoring experience. Provided globally so the
   NavBar (in the chrome) can toggle it and VaultView (in the router
   view) can react to it. */
const VIEW_MODE_KEY = 'docus.vault.viewMode'

function readViewMode(): VaultViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY)
    if (raw === 'read' || raw === 'edit') return raw
  } catch { /* private mode / storage blocked — fall through */ }
  return 'edit'
}

const viewMode = ref<VaultViewMode>(readViewMode())
function setViewMode(m: VaultViewMode) {
  viewMode.value = m
  try { localStorage.setItem(VIEW_MODE_KEY, m) } catch { /* ignore */ }
}
function toggleViewMode() {
  setViewMode(viewMode.value === 'edit' ? 'read' : 'edit')
}
provide(VaultViewModeKey, { mode: viewMode, set: setViewMode, toggle: toggleViewMode })
</script>

<template>
  <NavBar :is-vault="isVault" @open-search="onOpenSearch" />
  <RouterView v-slot="{ Component, route: r }">
    <!-- Do not key the wrapper on r.fullPath. The key on <main> caused
         VaultView to re-mount on every route change (e.g. /vault ->
         /vault/inbox/markdown-syntax), which reset the tabs ref to []
         and made multi-tab state impossible to keep. The component
         itself is keyed by the router, and re-mounting on every
         navigation is what we explicitly want to avoid. -->
    <main
      :class="['container', { 'full-width': r.meta.fullWidth }]"
      :style="{ '--navbar-h': isVault ? '36px' : '56px' }"
    >
      <component :is="Component" />
    </main>
  </RouterView>
  <ToastHost />
  <ConfirmHost />
  <PromptHost />
</template>
