<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  ExcalidrawIslandHandle,
  ExcalidrawIslandTheme,
} from '../../features/board/engine/excalidraw/reactIsland'

const props = withDefaults(defineProps<{
  theme?: ExcalidrawIslandTheme
}>(), {
  theme: 'light',
})

const emit = defineEmits<{
  change: []
  ready: []
  error: [error: unknown]
}>()

const host = ref<HTMLElement | null>(null)
let island: ExcalidrawIslandHandle | null = null
let mountGeneration = 0

onMounted(() => {
  const generation = ++mountGeneration

  void import('../../features/board/engine/excalidraw/reactIsland').then(async (module) => {
    if (generation !== mountGeneration || !host.value) return

    const nextIsland = await module.mountExcalidrawIsland({
      container: host.value,
      theme: props.theme,
      onChange: () => emit('change'),
      onReady: () => emit('ready'),
      onError: (error) => emit('error', error),
    })

    if (generation !== mountGeneration) {
      nextIsland.unmount()
      return
    }

    island = nextIsland
  }).catch((error: unknown) => {
    if (generation === mountGeneration) emit('error', error)
  })
})

watch(() => props.theme, (theme) => {
  island?.update({ theme })
})

onBeforeUnmount(() => {
  mountGeneration += 1
  island?.unmount()
  island = null
})
</script>

<template>
  <div ref="host" class="excalidraw-host" data-testid="excalidraw-host" />
</template>

<style scoped>
.excalidraw-host {
  width: 100%;
  height: 100%;
  min-height: 32rem;
}

.excalidraw-host :deep(.excalidraw) {
  width: 100%;
  height: 100%;
}
</style>
