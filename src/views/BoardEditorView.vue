<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { NButton, NDropdown, NSpin } from 'naive-ui'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import ExcalidrawHost from '../components/board/ExcalidrawHost.vue'
import { BoardApiError, deleteBoard, getBoard, type BoardAggregate } from '../features/board/api'
import { boardMetadataSource } from '../features/board/boardMetadataSource'
import {
  assertSupportedExcalidrawScene,
  excalidrawAdapter,
  runtimePersistenceFingerprint,
} from '../features/board/engine/excalidrawAdapter'
import {
  BoardEngineCompatibilityError,
  type BoardRuntimeAsset,
  type ExcalidrawRuntimeScene,
} from '../features/board/engine/types'
import { useI18n } from '../composables/useI18n'
import { useTheme } from '../composables/useTheme'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import {
  createIndexedDbBoardCheckpointStore,
  BoardRecoveryStoreError,
  type BoardCheckpointStore,
} from '../features/board/checkpointStore'
import { createBoardCheckpointScheduler, type BoardCheckpointScheduler } from '../features/board/checkpointScheduler'
import { reconcileBoardCheckpoint, type BoardCheckpointReconciliation } from '../features/board/checkpointReconciliation'
import type { BoardCheckpoint } from '../features/board/recoveryTypes'
import { createBoardAssetSession, type BoardAssetSession } from '../features/board/assetSession'
import { BoardAssetError } from '../features/board/assetClient'
import { boardExportFilename, downloadBoardBlob, type BoardExportFormat } from '../features/board/boardExport'
import { createBoardThumbnailScheduler, type BoardThumbnailScheduler } from '../features/board/thumbnailScheduler'
import {
  createBoardSaveCoordinator,
  type BoardSaveCoordinator,
  type BoardSaveState,
} from '../features/board/saveCoordinator'

type EditorStatus = 'loading' | 'reconciling' | 'recovery-choice' | 'recovery-conflict' | 'hydrating' | 'ready' | 'error'
type EditorErrorKind = 'load' | 'not-found' | 'compatibility' | 'canvas' | 'recovery'

interface PendingRecovery {
  kind: 'choice' | 'conflict' | 'invalid' | 'read-error'
  aggregate: BoardAggregate
  checkpoint: BoardCheckpoint | null
  reason: string
}

interface BoardSession {
  boardId: string
  serverRevision: number
  baseRevision: number
  localRevision: number
}

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()
const { theme } = useTheme()
const toast = useToast()
const { confirm } = useConfirm()
const status = ref<EditorStatus>('loading')
const errorKind = ref<EditorErrorKind | null>(null)
const errorMessage = ref('')
const aggregate = shallowRef<BoardAggregate | null>(null)
const session = shallowRef<BoardSession | null>(null)
const runtimeScene = shallowRef<ExcalidrawRuntimeScene | null>(null)
const saveCoordinator = shallowRef<BoardSaveCoordinator<ExcalidrawRuntimeScene> | null>(null)
const saveState = shallowRef<BoardSaveState | null>(null)
const checkpointScheduler = shallowRef<BoardCheckpointScheduler<ExcalidrawRuntimeScene> | null>(null)
const thumbnailScheduler = shallowRef<BoardThumbnailScheduler<ExcalidrawRuntimeScene> | null>(null)
const assetSession = shallowRef<BoardAssetSession | null>(null)
const pendingRecovery = shallowRef<PendingRecovery | null>(null)
const recoveryUnavailable = ref(false)
const exportBusy = ref<BoardExportFormat | null>(null)
const deleting = ref(false)
const loadGeneration = ref(0)
const recoveryStore: BoardCheckpointStore = createIndexedDbBoardCheckpointStore()
let assetIntakePromise: Promise<void> = Promise.resolve()
let hostChangePromise: Promise<void> = Promise.resolve()

const boardId = computed(() => {
  const value = route.params.boardId
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
})
const boardTitle = computed(() => aggregate.value?.metadata.title ?? t('board.title'))
const excalidrawLangCode = computed(() => locale.value.startsWith('zh') ? 'zh-CN' as const : 'en' as const)
const errorTitle = computed(() => {
  if (errorKind.value === 'not-found') return t('board.editor_not_found')
  if (errorKind.value === 'compatibility') return t('board.editor_scene_unsupported')
  if (errorKind.value === 'canvas') return t('board.editor_canvas_failed')
  if (errorKind.value === 'recovery') return t('board.editor_recovery_failed')
  return t('board.editor_load_failed')
})
const errorDescription = computed(() => errorMessage.value || errorTitle.value)
const statusLabel = computed(() => {
  if (status.value === 'loading') return t('board.editor_loading')
  if (status.value === 'reconciling') return t('board.editor_reconciling')
  if (status.value === 'recovery-choice') return t('board.editor_recovery_found')
  if (status.value === 'recovery-conflict') return t('board.editor_recovery_conflict')
  if (status.value === 'hydrating') return t('board.editor_hydrating')
  if (status.value === 'ready') return t('board.editor_ready')
  return errorTitle.value
})

function errorInfo(error: unknown): { kind: EditorErrorKind; message: string } {
  if (error instanceof BoardApiError && (error.status === 404 || error.code === 'BOARD_NOT_FOUND')) {
    return { kind: 'not-found', message: error.message }
  }
  if (error instanceof BoardEngineCompatibilityError) {
    return { kind: 'compatibility', message: error.message }
  }
  if (error instanceof BoardAssetError) {
    return { kind: 'load', message: t('board.editor_asset_restore_failed') }
  }
  return {
    kind: 'load',
    message: error instanceof Error && error.message.trim() ? error.message : t('board.editor_load_failed'),
  }
}

function assetFailureMessage(error: unknown, fallback: 'upload' | 'restore'): string {
  if (error instanceof BoardAssetError) {
    return t(fallback === 'upload' ? 'board.editor_asset_upload_failed' : 'board.editor_asset_restore_failed')
  }
  return error instanceof Error && error.message.trim()
    ? error.message
    : t(fallback === 'upload' ? 'board.editor_asset_upload_failed' : 'board.editor_asset_restore_failed')
}

function showLoadError(error: unknown): void {
  const info = errorInfo(error)
  status.value = 'error'
  errorKind.value = info.kind
  errorMessage.value = info.message
  aggregate.value = null
  session.value = null
  runtimeScene.value = null
  disposePersistence()
}

function disposePersistence(): void {
  thumbnailScheduler.value?.dispose()
  thumbnailScheduler.value = null
  checkpointScheduler.value?.dispose()
  checkpointScheduler.value = null
  saveCoordinator.value?.dispose()
  saveCoordinator.value = null
  assetSession.value?.dispose()
  assetSession.value = null
  saveState.value = null
}

async function mountScene(
  nextAggregate: BoardAggregate,
  chosenScene: BoardAggregate['sceneRecord']['scene'],
  checkpoint: BoardCheckpoint | null,
  recoveryConflict: boolean,
): Promise<void> {
  const generation = loadGeneration.value
  status.value = 'hydrating'
  const record = nextAggregate.sceneRecord
  const id = record.boardId
  const nextAssetSession = createBoardAssetSession({ boardId: id, store: recoveryStore })
  try {
    nextAssetSession.seedScene(chosenScene)
    const resolvedAssets = await nextAssetSession.resolveSceneAssets(chosenScene)
    const nextRuntimeScene = await excalidrawAdapter.hydrate(chosenScene, resolvedAssets)
    if (generation !== loadGeneration.value) {
      nextAssetSession.dispose()
      return
    }

    assetSession.value = nextAssetSession
    assetIntakePromise = Promise.resolve()
    hostChangePromise = Promise.resolve()
    aggregate.value = nextAggregate
    boardMetadataSource.upsert(nextAggregate.metadata)
    session.value = {
      boardId: id,
      serverRevision: record.revision,
      baseRevision: checkpoint?.baseRevision ?? record.revision,
      localRevision: checkpoint?.localRevision ?? 0,
    }
    runtimeScene.value = nextRuntimeScene

    const serialize = (scene: ExcalidrawRuntimeScene) => (
      excalidrawAdapter.serialize(scene, nextAssetSession.getFileMap())
    )
    const scheduler = createBoardCheckpointScheduler<ExcalidrawRuntimeScene>({
      boardId: id,
      sceneVersion: record.sceneVersion,
      initialRuntimeScene: nextRuntimeScene,
      initialLocalRevision: checkpoint?.localRevision,
      initialBaseRevision: checkpoint?.baseRevision ?? record.revision,
      serialize,
      store: recoveryStore,
      onStateChange: (nextState) => {
        if (nextState.status === 'error' || nextState.status === 'unavailable') {
          recoveryUnavailable.value = true
          toast.error(t('board.editor_recovery_unavailable'))
        }
      },
    })
    checkpointScheduler.value = scheduler
    const thumbnail = createBoardThumbnailScheduler<ExcalidrawRuntimeScene>({
      boardId: id,
      adapter: excalidrawAdapter,
      onSuccess: ({ response }) => {
        if (thumbnailScheduler.value !== thumbnail || aggregate.value?.metadata.id !== id) return
        const metadata = {
          ...aggregate.value.metadata,
          thumbnailAssetId: response.thumbnailAssetId,
        }
        aggregate.value = { ...aggregate.value, metadata }
        boardMetadataSource.upsert(metadata)
      },
      onFailure: () => {
        if (thumbnailScheduler.value !== thumbnail) return
        toast.error(t('board.editor_thumbnail_failed'))
      },
    })
    thumbnailScheduler.value = thumbnail
    const coordinator = createBoardSaveCoordinator<ExcalidrawRuntimeScene>({
      boardId: id,
      engine: record.engine,
      sceneVersion: record.sceneVersion,
      currentServerRevision: record.revision,
      initialBaseRevision: checkpoint?.baseRevision,
      initialLocalRevision: checkpoint?.localRevision,
      initialLastSavedLocalRevision: checkpoint ? 0 : undefined,
      initialDirty: Boolean(checkpoint),
      initialConflict: recoveryConflict,
      initialRuntimeScene: nextRuntimeScene,
      initialFingerprint: runtimePersistenceFingerprint(nextRuntimeScene),
      serialize,
      prepareSave: async (scene) => {
        await nextAssetSession.ensureSceneAssetsReady(serialize(scene))
      },
      onMeaningfulChange: ({ runtimeScene: changedScene, localRevision, baseRevision }) => {
        scheduler.schedule(changedScene, localRevision, baseRevision)
      },
      onSaveSucceeded: (event) => {
        scheduler.onServerSaveSucceeded(event)
        thumbnail.schedule({ runtimeScene: event.runtimeScene, revision: event.savedLocalRevision })
      },
      onStateChange: (nextState) => {
        saveState.value = nextState
        if (!session.value || session.value.boardId !== id) return
        session.value = {
          ...session.value,
          serverRevision: nextState.currentServerRevision,
          baseRevision: nextState.baseRevision,
          localRevision: nextState.localRevision,
        }
      },
      onMetadataUpdated: (updatedAt) => {
        if (aggregate.value?.metadata.id !== id) return
        const metadata = { ...aggregate.value.metadata, updatedAt }
        aggregate.value = { ...aggregate.value, metadata }
        boardMetadataSource.upsert(metadata)
      },
    })
    saveCoordinator.value = coordinator
    saveState.value = coordinator.getSnapshot()
    if (checkpoint && !recoveryConflict) coordinator.schedule()
  } catch (error) {
    nextAssetSession.dispose()
    throw error
  }
}

function recoveryReason(reconciliation: BoardCheckpointReconciliation): string {
  if (reconciliation.kind !== 'invalid') return ''
  return t(`board.editor_recovery_invalid_${reconciliation.reason}` as Parameters<typeof t>[0])
}

async function loadBoard(): Promise<void> {
  const generation = ++loadGeneration.value
  disposePersistence()
  status.value = 'loading'
  errorKind.value = null
  errorMessage.value = ''
  aggregate.value = null
  session.value = null
  runtimeScene.value = null
  pendingRecovery.value = null
  recoveryUnavailable.value = false
  const id = boardId.value
  if (!id) return

  try {
    const nextAggregate = await getBoard(id)
    if (generation !== loadGeneration.value) return
    const record = nextAggregate.sceneRecord
    assertSupportedExcalidrawScene(record.engine, record.sceneVersion)
    // Validate the server scene before asking the user about any local copy.
    excalidrawAdapter.validate(record.scene)
    status.value = 'reconciling'
    let checkpoint: BoardCheckpoint | null
    try {
      checkpoint = await recoveryStore.get(id)
    } catch (error) {
      if (error instanceof BoardRecoveryStoreError && error.code === 'BOARD_RECOVERY_UNAVAILABLE') {
        recoveryUnavailable.value = true
        toast.error(t('board.editor_recovery_unavailable'))
        await mountScene(nextAggregate, record.scene, null, false)
        return
      }
      pendingRecovery.value = {
        kind: 'read-error',
        aggregate: nextAggregate,
        checkpoint: null,
        reason: error instanceof Error ? error.message : t('board.editor_recovery_read_failed'),
      }
      status.value = 'recovery-choice'
      return
    }
    if (generation !== loadGeneration.value) return
    const reconciliation = reconcileBoardCheckpoint({
      serverRecord: record,
      checkpoint,
      validateScene: (scene) => { excalidrawAdapter.validate(scene) },
    })
    if (reconciliation.kind === 'server') {
      await mountScene(nextAggregate, reconciliation.scene, null, false)
      return
    }
    if (reconciliation.kind === 'recover-local') {
      pendingRecovery.value = {
        kind: 'choice',
        aggregate: nextAggregate,
        checkpoint: reconciliation.checkpoint,
        reason: t('board.editor_recovery_found_detail'),
      }
      status.value = 'recovery-choice'
      return
    }
    if (reconciliation.kind === 'conflict') {
      pendingRecovery.value = {
        kind: 'conflict',
        aggregate: nextAggregate,
        checkpoint: reconciliation.checkpoint,
        reason: t('board.editor_recovery_conflict_detail'),
      }
      status.value = 'recovery-conflict'
      return
    }
    pendingRecovery.value = {
      kind: 'invalid',
      aggregate: nextAggregate,
      checkpoint,
      reason: recoveryReason(reconciliation),
    }
    status.value = 'recovery-choice'
  } catch (error) {
    if (generation !== loadGeneration.value) return
    showLoadError(error)
  }
}

async function recoverLocal(): Promise<void> {
  const pending = pendingRecovery.value
  if (!pending?.checkpoint) return
  pendingRecovery.value = null
  try {
    await mountScene(pending.aggregate, pending.checkpoint.scene, pending.checkpoint, false)
  } catch (error) {
    showLoadError(error)
  }
}

async function discardLocal(): Promise<void> {
  const pending = pendingRecovery.value
  if (!pending) return
  if (pending.checkpoint) {
    try {
      await recoveryStore.delete(pending.aggregate.metadata.id)
    } catch (error) {
      pendingRecovery.value = { ...pending, reason: error instanceof Error ? error.message : t('board.editor_recovery_delete_failed') }
      return
    }
  }
  pendingRecovery.value = null
  try {
    await mountScene(pending.aggregate, pending.aggregate.sceneRecord.scene, null, false)
  } catch (error) {
    showLoadError(error)
  }
}

async function openServerVersionFromRecovery(): Promise<void> {
  const pending = pendingRecovery.value
  if (!pending) return
  if (pending.kind === 'conflict') {
    await discardLocal()
    return
  }
  pendingRecovery.value = null
  try {
    await mountScene(pending.aggregate, pending.aggregate.sceneRecord.scene, null, false)
  } catch (error) {
    showLoadError(error)
  }
}

function retryRecoveryRead(): void {
  void loadBoard()
}

async function keepLocalRecoveryOpen(): Promise<void> {
  const pending = pendingRecovery.value
  if (!pending?.checkpoint) return
  pendingRecovery.value = null
  try {
    await mountScene(pending.aggregate, pending.checkpoint.scene, pending.checkpoint, true)
  } catch (error) {
    showLoadError(error)
  }
}

function onHostReady(): void {
  if (status.value === 'hydrating') status.value = 'ready'
}

let hostChangeSequence = 0

function onHostAssetsChanged(assets: readonly BoardRuntimeAsset[]): void {
  if (deleting.value) return
  const currentAssetSession = assetSession.value
  if (!currentAssetSession) return
  const intake = currentAssetSession.observeRuntimeAssets(assets)
  assetIntakePromise = Promise.all([
    assetIntakePromise.catch(() => {}),
    intake,
  ]).then(() => undefined)
  void assetIntakePromise.catch((error: unknown) => {
    if (currentAssetSession !== assetSession.value) return
    toast.error(assetFailureMessage(error, 'upload'))
  })
}

function onHostChange(nextRuntimeScene: ExcalidrawRuntimeScene): void {
  if (deleting.value || status.value !== 'ready' || !session.value || !saveCoordinator.value || !assetSession.value) return
  const sequence = ++hostChangeSequence
  const currentCoordinator = saveCoordinator.value
  const currentAssetSession = assetSession.value
  const currentIntake = assetIntakePromise
  const change = currentIntake.catch(() => {}).then(() => currentAssetSession.ensureCheckpointAssetsDurable(nextRuntimeScene)).then(() => {
    if (sequence !== hostChangeSequence
      || status.value !== 'ready'
      || currentCoordinator !== saveCoordinator.value
      || currentAssetSession !== assetSession.value) return
    runtimeScene.value = nextRuntimeScene
    currentCoordinator.recordChange(nextRuntimeScene, runtimePersistenceFingerprint(nextRuntimeScene))
  }).catch((error: unknown) => {
    if (sequence !== hostChangeSequence || currentAssetSession !== assetSession.value) return
    toast.error(assetFailureMessage(error, 'upload'))
  })
  hostChangePromise = Promise.all([
    hostChangePromise.catch(() => {}),
    change,
  ]).then(() => undefined)
}

function onHostError(error: unknown): void {
  if (status.value === 'error') return
  status.value = 'error'
  errorKind.value = 'canvas'
  errorMessage.value = error instanceof Error ? error.message : String(error)
  session.value = null
  runtimeScene.value = null
}

function onHostAssetError(error: unknown): void {
  if (status.value === 'error') return
  toast.error(assetFailureMessage(error, 'upload'))
}

const displayedSaveStatus = computed(() => {
  if (status.value !== 'ready') return null
  return saveState.value?.status ?? 'saved'
})

const hasSaveRisk = computed(() => {
  const state = saveState.value
  return Boolean(state && (state.dirty || state.saveInFlight || state.status === 'error' || state.status === 'conflict' || state.status === 'uncertain'))
})

const saveStatusLabel = computed(() => {
  switch (displayedSaveStatus.value) {
    case 'saving': return t('board.editor_save_saving')
    case 'dirty': return t('board.editor_save_dirty')
    case 'error': return t('board.editor_save_error')
    case 'conflict': return t('board.editor_save_conflict')
    case 'uncertain': return t('board.editor_save_uncertain')
    default: return t('board.editor_save_saved')
  }
})

async function leaveAfterFlush(): Promise<boolean> {
  let assetPreparationFailed = false
  try {
    await assetIntakePromise
  } catch {
    assetPreparationFailed = true
  }
  try {
    await hostChangePromise
  } catch {
    assetPreparationFailed = true
  }
  if (assetPreparationFailed) {
    const leave = await confirm(
      t('board.editor_leave_title'),
      t('board.editor_leave_detail'),
      {
        confirmLabel: t('board.editor_leave_anyway'),
        cancelLabel: t('board.editor_stay'),
        destructive: true,
      },
    )
    if (!leave) return false
  }
  const coordinator = saveCoordinator.value
  if (!coordinator) return true
  const result = await coordinator.flush()
  if (result.ok) return true
  const leave = await confirm(
    t('board.editor_leave_title'),
    t('board.editor_leave_detail'),
    {
      confirmLabel: t('board.editor_leave_anyway'),
      cancelLabel: t('board.editor_stay'),
      destructive: true,
    },
  )
  return leave
}

onBeforeRouteLeave(() => leaveAfterFlush())
onBeforeRouteUpdate((to) => {
  if (to.params.boardId === route.params.boardId) return true
  return leaveAfterFlush()
})

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasSaveRisk.value) return
  event.preventDefault()
  event.returnValue = ''
}

async function reloadServerVersion(): Promise<void> {
  const discard = await confirm(
    t('board.editor_reload_title'),
    t('board.editor_reload_detail'),
    {
      confirmLabel: t('board.editor_reload_confirm'),
      cancelLabel: t('board.editor_stay'),
      destructive: true,
    },
  )
  if (!discard) return
  try {
    if (session.value) await recoveryStore.delete(session.value.boardId)
  } catch {
    toast.error(t('board.editor_recovery_delete_failed'))
    return
  }
  await loadBoard()
}

function keepEditingLocally(): void {
  toast.info(t('board.editor_keep_local'))
}

async function retrySave(): Promise<void> {
  await saveCoordinator.value?.retry()
}

const editorMenuOptions = computed(() => [
  {
    label: t('board.editor_export_png'),
    key: 'export-png',
    disabled: status.value !== 'ready' || exportBusy.value !== null || deleting.value,
  },
  {
    label: t('board.editor_export_svg'),
    key: 'export-svg',
    disabled: status.value !== 'ready' || exportBusy.value !== null || deleting.value,
  },
  { type: 'divider', key: 'divider' },
  {
    label: t('board.editor_delete'),
    key: 'delete',
    disabled: !session.value || deleting.value,
  },
])

async function exportBoard(format: BoardExportFormat): Promise<void> {
  const scene = runtimeScene.value
  if (exportBusy.value !== null || status.value !== 'ready' || !scene) return
  exportBusy.value = format
  try {
    const output = format === 'png'
      ? await excalidrawAdapter.exportPng(scene)
      : await excalidrawAdapter.exportSvg(scene)
    const blob = typeof output === 'string'
      ? new Blob([output], { type: 'image/svg+xml;charset=utf-8' })
      : output
    downloadBoardBlob(blob, boardExportFilename(boardTitle.value, format))
  } catch {
    toast.error(t('board.editor_export_failed'))
  } finally {
    exportBusy.value = null
  }
}

function onEditorMenuSelect(key: string): void {
  if (key === 'export-png') {
    void exportBoard('png')
  } else if (key === 'export-svg') {
    void exportBoard('svg')
  } else if (key === 'delete') {
    void deleteCurrentBoard()
  }
}

async function deleteCurrentBoard(): Promise<void> {
  if (deleting.value || !session.value) return
  const id = session.value.boardId
  const confirmed = await confirm(
    t('board.editor_delete_title', { title: boardTitle.value }),
    t('board.editor_delete_detail'),
    {
      confirmLabel: t('board.delete'),
      cancelLabel: t('board.editor_stay'),
      destructive: true,
    },
  )
  if (!confirmed || !session.value || session.value.boardId !== id) return

  deleting.value = true
  try {
    await deleteBoard(id)
    boardMetadataSource.remove(id)
    // A delete request is now the lifecycle authority. Drop queued derived
    // work; an already-running thumbnail job may finish and harmlessly receive
    // a 404 from the deleted Board. Keeping this after the server call means a
    // failed delete leaves the editor fully usable.
    thumbnailScheduler.value?.dispose({ drain: false })
    const currentCheckpointScheduler = checkpointScheduler.value
    const currentAssetSession = assetSession.value
    hostChangeSequence += 1
    currentCheckpointScheduler?.dispose({ drain: false })
    currentAssetSession?.dispose()
    await Promise.all([
      assetIntakePromise.catch(() => {}),
      hostChangePromise.catch(() => {}),
      currentCheckpointScheduler?.waitForIdle() ?? Promise.resolve(),
    ])
    try {
      await recoveryStore.clearBoardRecovery(id)
    } catch {
      toast.error(t('board.recovery_cleanup_failed'))
    }
    // Prevent the route guard from trying to save a dirty scene after the
    // server has already deleted its Board row.
    disposePersistence()
    await router.push({ name: 'board' })
  } catch (error) {
    toast.error(error instanceof Error && error.message.trim()
      ? error.message
      : t('board.editor_delete_failed'))
  } finally {
    deleting.value = false
  }
}

function backToBoards(): void {
  void router.push({ name: 'board' })
}

watch(() => boardId.value, () => { void loadBoard() }, { immediate: true })
onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onBeforeUnmount(() => {
  loadGeneration.value += 1
  window.removeEventListener('beforeunload', handleBeforeUnload)
  disposePersistence()
})
</script>

<template>
  <main class="board-editor" data-testid="board-editor">
    <header class="board-editor-chrome">
      <NButton attr-type="button" quaternary @click="backToBoards">← {{ t('board.back_to_boards') }}</NButton>
      <div class="board-editor-title" :title="boardTitle">{{ boardTitle }}</div>
      <div class="board-editor-status" :data-status="status" data-testid="board-editor-status" role="status" aria-live="polite">
        <span>{{ statusLabel }}</span>
        <span v-if="displayedSaveStatus" :data-save-status="displayedSaveStatus">{{ saveStatusLabel }}</span>
        <span v-if="recoveryUnavailable" data-testid="board-recovery-unavailable">{{ t('board.editor_recovery_unavailable_short') }}</span>
        <NButton v-if="displayedSaveStatus === 'error'" text size="tiny" attr-type="button" @click="retrySave">{{ t('board.editor_retry_save') }}</NButton>
        <span v-if="session" class="board-editor-revision" data-testid="board-local-revision" :data-local-revision="session.localRevision">{{ session.localRevision }}</span>
      </div>
      <NDropdown
        :options="editorMenuOptions"
        placement="bottom-end"
        trigger="click"
        @select="onEditorMenuSelect"
      >
        <NButton
          class="board-editor-menu"
          attr-type="button"
          quaternary
          :disabled="deleting"
          :aria-label="t('board.editor_menu')"
          data-testid="board-editor-menu"
        >
          ⋯
        </NButton>
      </NDropdown>
    </header>

    <section v-if="status === 'loading'" class="board-editor-state" data-testid="board-editor-loading" role="status">
      <NSpin size="medium" />
      <span>{{ t('board.editor_loading') }}</span>
    </section>

    <section v-else-if="status === 'reconciling'" class="board-editor-state" data-testid="board-editor-reconciling" role="status">
      <NSpin size="medium" />
      <span>{{ t('board.editor_reconciling') }}</span>
    </section>

    <section v-else-if="status === 'recovery-choice'" class="board-editor-state board-editor-recovery" data-testid="board-editor-recovery" role="alert">
      <h1>{{ pendingRecovery?.kind === 'invalid' ? t('board.editor_recovery_damaged') : t('board.editor_recovery_found') }}</h1>
      <p>{{ pendingRecovery?.reason }}</p>
      <div class="board-editor-actions">
        <NButton v-if="pendingRecovery?.kind === 'choice'" attr-type="button" type="primary" @click="recoverLocal">{{ t('board.editor_recover_local') }}</NButton>
        <NButton v-if="pendingRecovery?.kind !== 'read-error'" attr-type="button" @click="discardLocal">{{ t('board.editor_discard_local') }}</NButton>
        <NButton v-if="pendingRecovery?.kind === 'read-error' || pendingRecovery?.kind === 'invalid'" attr-type="button" @click="openServerVersionFromRecovery">{{ t('board.editor_open_server') }}</NButton>
        <NButton v-if="pendingRecovery?.kind === 'read-error'" attr-type="button" @click="retryRecoveryRead">{{ t('common.retry') }}</NButton>
      </div>
    </section>

    <section v-else-if="status === 'recovery-conflict'" class="board-editor-state board-editor-recovery" data-testid="board-editor-recovery-conflict" role="alert">
      <h1>{{ t('board.editor_recovery_conflict') }}</h1>
      <p>{{ pendingRecovery?.reason }}</p>
      <div class="board-editor-actions">
        <NButton attr-type="button" type="primary" @click="keepLocalRecoveryOpen">{{ t('board.editor_keep_local_recovery') }}</NButton>
        <NButton attr-type="button" @click="openServerVersionFromRecovery">{{ t('board.editor_open_server') }}</NButton>
      </div>
    </section>

    <section v-else-if="status === 'error'" class="board-editor-state" data-testid="board-editor-error" role="alert">
      <h1>{{ errorTitle }}</h1>
      <p>{{ errorDescription }}</p>
      <div class="board-editor-actions">
        <NButton attr-type="button" type="primary" @click="loadBoard">{{ t('common.retry') }}</NButton>
        <NButton attr-type="button" @click="backToBoards">{{ t('board.back_to_boards') }}</NButton>
      </div>
    </section>

    <section v-else class="board-editor-surface" data-testid="board-editor-surface" :aria-label="t('board.editor_canvas_label')">
      <div v-if="displayedSaveStatus === 'conflict'" class="board-editor-conflict" data-testid="board-editor-conflict" role="alert">
        <p>{{ t('board.editor_conflict_detail') }}</p>
        <div class="board-editor-actions">
          <NButton attr-type="button" type="primary" @click="reloadServerVersion">{{ t('board.editor_reload_server') }}</NButton>
          <NButton attr-type="button" @click="keepEditingLocally">{{ t('board.editor_keep_editing') }}</NButton>
        </div>
      </div>
      <ExcalidrawHost
        v-if="runtimeScene && session"
        :initial-scene="runtimeScene"
        :theme="theme"
        :lang-code="excalidrawLangCode"
        @change="onHostChange"
        @assets-changed="onHostAssetsChanged"
        @asset-error="onHostAssetError"
        @ready="onHostReady"
        @error="onHostError"
      />
    </section>
  </main>
</template>

<style scoped>
.board-editor { display: flex; flex-direction: column; width: 100%; height: 100vh; min-height: 0; overflow: hidden; background: var(--bg); color: var(--text); }
.board-editor-chrome { display: flex; align-items: center; gap: .75rem; flex: 0 0 52px; box-sizing: border-box; padding: .5rem .75rem; border-bottom: 1px solid var(--border, var(--docus-border, #d1d5db)); background: var(--surface, var(--bg)); }
.board-editor-title { min-width: 0; flex: 1; overflow: hidden; color: var(--text-h, inherit); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.board-editor-status { display: flex; align-items: center; gap: .35rem; color: var(--text-muted, #6b7280); font-size: .8rem; }
.board-editor-menu { flex: 0 0 auto; min-width: 2rem; color: var(--text-h, inherit); font-size: 1.25rem; line-height: 1; }
.board-editor-revision { display: none; }
.board-editor-surface { flex: 1 1 auto; min-height: 0; overflow: hidden; }
.board-editor-surface :deep(.excalidraw-host) { min-height: 0; height: 100%; }
.board-editor-state { display: grid; flex: 1; place-content: center; justify-items: center; gap: .75rem; min-height: 18rem; padding: 2rem; background: var(--surface, var(--bg)); color: var(--text); text-align: center; }
.board-editor-state h1, .board-editor-state p { max-width: 36rem; margin: 0; }
.board-editor-state h1 { color: var(--text-h, inherit); font-size: 1.2rem; }
.board-editor-state p { color: var(--text-muted, #6b7280); }
.board-editor-recovery { min-height: 360px; }
.board-editor-actions { display: flex; gap: .5rem; }
.board-editor-conflict { position: absolute; z-index: 2; top: .75rem; right: .75rem; max-width: 28rem; padding: .75rem; border: 1px solid var(--border, #d1d5db); border-radius: .5rem; background: var(--surface, var(--bg)); box-shadow: 0 .5rem 1.5rem rgb(0 0 0 / 12%); }
.board-editor-conflict p { margin: 0 0 .75rem; color: var(--text-h, inherit); }
.board-editor-surface { position: relative; }
@media (max-width: 640px) {
  .board-editor-chrome { gap: .4rem; padding-inline: .5rem; }
  .board-editor-status { min-width: 0; overflow: hidden; }
  .board-editor-status > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
</style>
