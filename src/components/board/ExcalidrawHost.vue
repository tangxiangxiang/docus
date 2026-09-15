<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  ExcalidrawIslandHandle,
  ExcalidrawIslandLangCode,
  ExcalidrawIslandTheme,
} from '../../features/board/engine/excalidraw/reactIsland'
import type { BoardRuntimeAsset, ExcalidrawRuntimeScene } from '../../features/board/engine/types'

const props = withDefaults(defineProps<{
  initialScene: ExcalidrawRuntimeScene
  theme?: ExcalidrawIslandTheme
  langCode?: ExcalidrawIslandLangCode
}>(), {
  theme: 'light',
  langCode: 'en',
})

const emit = defineEmits<{
  change: [scene: ExcalidrawRuntimeScene]
  assetsChanged: [assets: readonly BoardRuntimeAsset[]]
  assetError: [error: unknown]
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
      initialScene: props.initialScene,
      theme: props.theme,
      langCode: props.langCode,
      onChange: (scene) => emit('change', scene),
      onAssetsChanged: (assets) => emit('assetsChanged', assets),
      onAssetError: (error) => emit('assetError', error),
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

watch([() => props.theme, () => props.langCode], ([theme, langCode]) => {
  island?.update({ theme, langCode })
})

onBeforeUnmount(() => {
  mountGeneration += 1
  island?.unmount()
  island = null
})
</script>

<template>
  <div
    ref="host"
    class="excalidraw-host"
    data-testid="excalidraw-host"
    data-board-excalidraw-root
  />
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
