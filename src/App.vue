<script setup lang="ts">
import NavBar from './components/NavBar.vue'
</script>

<template>
  <NavBar />
  <RouterView v-slot="{ Component, route }">
    <main :class="['container', { 'full-width': route.meta.fullWidth }]" :key="route.fullPath">
      <component :is="Component" />
    </main>
  </RouterView>
</template>
