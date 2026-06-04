<script setup lang="ts">
import { computed, provide, ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import NavBar from './components/NavBar.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmHost from './components/ConfirmHost.vue'
import PromptHost from './components/PromptHost.vue'

const route = useRoute()
const isVault = computed(() => route.meta.fullWidth === true)

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
