<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NavBar from './components/NavBar.vue'

const route = useRoute()
const isVault = computed(() => route.meta.fullWidth === true)
</script>

<template>
  <NavBar :is-vault="isVault" />
  <RouterView v-slot="{ Component, route: r }">
    <main
      :class="['container', { 'full-width': r.meta.fullWidth }]"
      :style="{ '--navbar-h': isVault ? '36px' : '56px' }"
      :key="r.fullPath"
    >
      <component :is="Component" />
    </main>
  </RouterView>
</template>
