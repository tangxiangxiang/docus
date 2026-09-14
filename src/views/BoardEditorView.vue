<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { NButton, NSpin } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import ExcalidrawHost from '../components/board/ExcalidrawHost.vue'
import { BoardApiError, getBoard, type BoardAggregate } from '../features/board/api'
import { boardMetadataSource } from '../features/board/boardMetadataSource'
import {
  assertSupportedExcalidrawScene,
  excalidrawAdapter,
} from '../features/board/engine/excalidrawAdapter'
import { BoardEngineCompatibilityError, type ExcalidrawRuntimeScene } from '../features/board/engine/types'
import type { BoardScene } from '../../shared/boardProtocol'
import { useI18n } from '../composables/useI18n'
import { useTheme } from '../composables/useTheme'
import { useToast } from '../composables/useToast'
import type { ExcalidrawUnsupportedAction } from '../features/board/engine/excalidraw/reactIsland'

type EditorStatus = 'loading' | 'hydrating' | 'ready' | 'error'
type EditorErrorKind = 'load' | 'not-found' | 'compatibility' | 'canvas'

interface BoardSession {
  boardId: string
  serverRevision: number
  baseRevision: number
  localRevision: number
  initialScene: BoardScene
  currentScene: BoardScene
}

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { theme } = useTheme()
const toast = useToast()
const status = ref<EditorStatus>('loading')
const errorKind = ref<EditorErrorKind | null>(null)
const errorMessage = ref('')
const aggregate = shallowRef<BoardAggregate | null>(null)
const session = shallowRef<BoardSession | null>(null)
const runtimeScene = shallowRef<ExcalidrawRuntimeScene | null>(null)
const loadGeneration = ref(0)

const boardId = computed(() => {
  const value = route.params.boardId
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
})
const boardTitle = computed(() => aggregate.value?.metadata.title ?? t('board.title'))
const errorTitle = computed(() => {
  if (errorKind.value === 'not-found') return t('board.editor_not_found')
  if (errorKind.value === 'compatibility') return t('board.editor_scene_unsupported')
  if (errorKind.value === 'canvas') return t('board.editor_canvas_failed')
  return t('board.editor_load_failed')
})
const errorDescription = computed(() => errorMessage.value || errorTitle.value)
const statusLabel = computed(() => {
  if (status.value === 'loading') return t('board.editor_loading')
  if (status.value === 'hydrating') return t('board.editor_hydrating')
  if (status.value === 'ready') return t('board.editor_ready')
  return errorTitle.value
})

function sceneFingerprint(scene: BoardScene): string {
  const engineData = scene.engineData as { elements?: unknown[]; fileMap?: Record<string, unknown> } | null
  const elements = Array.isArray(engineData?.elements) ? engineData.elements : []
  const elementKeys = elements.map((element) => {
    if (!element || typeof element !== 'object') return String(element)
    const value = element as Record<string, unknown>
    const points = Array.isArray(value.points) ? value.points.length : 0
    return [
      value.id, value.version, value.versionNonce, value.type, value.isDeleted,
      value.x, value.y, value.width, value.height, value.angle, value.text, points,
    ].map((part) => String(part)).join('|')
  })
  const persistent = Object.keys(scene.persistentAppState).sort().map((key) => `${key}:${String(scene.persistentAppState[key as keyof typeof scene.persistentAppState])}`)
  const fileMapKeys = Object.keys(engineData?.fileMap ?? {}).sort().map((key) => `${key}:${String(engineData?.fileMap?.[key])}`)
  return `${elementKeys.join(';;')}#${persistent.join(';')}#${fileMapKeys.join(';')}#${[...scene.assetRefs].sort().join(';')}`
}

function errorInfo(error: unknown): { kind: EditorErrorKind; message: string } {
  if (error instanceof BoardApiError && (error.status === 404 || error.code === 'BOARD_NOT_FOUND')) {
    return { kind: 'not-found', message: error.message }
  }
  if (error instanceof BoardEngineCompatibilityError) {
    return { kind: 'compatibility', message: error.message }
  }
  return {
    kind: 'load',
    message: error instanceof Error && error.message.trim() ? error.message : t('board.editor_load_failed'),
  }
}

async function loadBoard(): Promise<void> {
  const generation = ++loadGeneration.value
  status.value = 'loading'
  errorKind.value = null
  errorMessage.value = ''
  aggregate.value = null
  session.value = null
  runtimeScene.value = null
  const id = boardId.value
  if (!id) return

  try {
    const nextAggregate = await getBoard(id)
    if (generation !== loadGeneration.value) return
    const record = nextAggregate.sceneRecord
    assertSupportedExcalidrawScene(record.engine, record.sceneVersion)
    status.value = 'hydrating'
    const nextRuntimeScene = excalidrawAdapter.hydrate(record.scene)
    if (generation !== loadGeneration.value) return
    aggregate.value = nextAggregate
    boardMetadataSource.upsert(nextAggregate.metadata)
    session.value = {
      boardId: id,
      serverRevision: record.revision,
      baseRevision: record.revision,
      localRevision: 0,
      initialScene: record.scene,
      currentScene: record.scene,
    }
    runtimeScene.value = nextRuntimeScene
  } catch (error) {
    if (generation !== loadGeneration.value) return
    const info = errorInfo(error)
    status.value = 'error'
    errorKind.value = info.kind
    errorMessage.value = info.message
    aggregate.value = null
    session.value = null
    runtimeScene.value = null
  }
}

function onHostReady(): void {
  if (status.value === 'hydrating') status.value = 'ready'
}

function onHostChange(nextRuntimeScene: ExcalidrawRuntimeScene): void {
  if (status.value !== 'ready' || !session.value) return
  try {
    const nextScene = excalidrawAdapter.serialize(nextRuntimeScene)
    if (sceneFingerprint(nextScene) === sceneFingerprint(session.value.currentScene)) return
    session.value = {
      ...session.value,
      currentScene: nextScene,
      localRevision: session.value.localRevision + 1,
    }
  } catch (error) {
    status.value = 'error'
    errorKind.value = error instanceof BoardEngineCompatibilityError ? 'compatibility' : 'canvas'
    errorMessage.value = error instanceof Error ? error.message : String(error)
    session.value = null
    runtimeScene.value = null
  }
}

function onHostError(error: unknown): void {
  if (status.value === 'error') return
  status.value = 'error'
  errorKind.value = 'canvas'
  errorMessage.value = error instanceof Error ? error.message : String(error)
  session.value = null
  runtimeScene.value = null
}

function onUnsupportedAction(action: ExcalidrawUnsupportedAction): void {
  if (action.kind === 'image-insert') toast.info(t('board.editor_image_unsupported'))
}

function backToBoards(): void {
  void router.push({ name: 'board' })
}

watch(() => boardId.value, () => { void loadBoard() }, { immediate: true })
</script>

<template>
  <main class="board-editor" data-testid="board-editor">
    <header class="board-editor-chrome">
      <NButton attr-type="button" quaternary @click="backToBoards">← {{ t('board.back_to_boards') }}</NButton>
      <div class="board-editor-title" :title="boardTitle">{{ boardTitle }}</div>
      <div class="board-editor-status" :data-status="status" data-testid="board-editor-status" role="status" aria-live="polite">
        {{ statusLabel }}
        <span v-if="session" class="board-editor-revision" data-testid="board-local-revision" :data-local-revision="session.localRevision">{{ session.localRevision }}</span>
      </div>
    </header>

    <section v-if="status === 'loading'" class="board-editor-state" data-testid="board-editor-loading" role="status">
      <NSpin size="medium" />
      <span>{{ t('board.editor_loading') }}</span>
    </section>

    <section v-else-if="status === 'error'" class="board-editor-state" data-testid="board-editor-error" role="alert">
      <h1>{{ errorTitle }}</h1>
      <p>{{ errorDescription }}</p>
      <div class="board-editor-actions">
        <NButton attr-type="button" type="primary" @click="loadBoard">{{ t('common.retry') }}</NButton>
        <NButton attr-type="button" @click="backToBoards">{{ t('board.back_to_boards') }}</NButton>
      </div>
    </section>

    <section v-else class="board-editor-surface" data-testid="board-editor-surface" aria-label="Board canvas">
      <ExcalidrawHost
        v-if="runtimeScene && session"
        :initial-scene="runtimeScene"
        :theme="theme"
        @change="onHostChange"
        @ready="onHostReady"
        @error="onHostError"
        @unsupported-action="onUnsupportedAction"
      />
    </section>
  </main>
</template>

<style scoped>
.board-editor { display: flex; flex-direction: column; width: 100%; height: 100vh; min-height: 0; overflow: hidden; background: var(--bg); color: var(--text); }
.board-editor-chrome { display: flex; align-items: center; gap: .75rem; flex: 0 0 52px; box-sizing: border-box; padding: .5rem .75rem; border-bottom: 1px solid var(--border, var(--docus-border, #d1d5db)); background: var(--surface, var(--bg)); }
.board-editor-title { min-width: 0; flex: 1; overflow: hidden; color: var(--text-h, inherit); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.board-editor-status { display: flex; align-items: center; gap: .35rem; color: var(--text-muted, #6b7280); font-size: .8rem; }
.board-editor-revision { display: none; }
.board-editor-surface { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.board-editor-surface :deep(.excalidraw-host) { min-height: 0; height: 100%; }
.board-editor-state { display: grid; flex: 1; place-content: center; justify-items: center; gap: .75rem; padding: 2rem; text-align: center; }
.board-editor-state h1, .board-editor-state p { max-width: 36rem; margin: 0; }
.board-editor-state h1 { color: var(--text-h, inherit); font-size: 1.2rem; }
.board-editor-state p { color: var(--text-muted, #6b7280); }
.board-editor-actions { display: flex; gap: .5rem; }
</style>
