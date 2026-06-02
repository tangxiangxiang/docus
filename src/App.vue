<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { useRoute } from 'vue-router'
import NavBar from './components/NavBar.vue'
import ToastHost from './components/ToastHost.vue'
import ConfirmHost from './components/ConfirmHost.vue'

const route = useRoute()
const isVault = computed(() => route.meta.fullWidth === true)

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
    <main
      :class="['container', { 'full-width': r.meta.fullWidth }]"
      :style="{ '--navbar-h': isVault ? '36px' : '56px' }"
      :key="r.fullPath"
    >
      <component :is="Component" />
    </main>
  </RouterView>
  <ToastHost />
  <ConfirmHost />
</template>
