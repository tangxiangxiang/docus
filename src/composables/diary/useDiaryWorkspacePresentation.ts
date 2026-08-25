import { computed, ref, watch, type Ref } from 'vue'
import type { DiaryDate } from '../../../shared/diaryProtocol'
import type { DiaryDateCommandResult } from './useDiaryDateCommand'

export type DiaryPresentationMode = 'home' | 'reader' | 'editor'
export type DiaryPresentationFocusOrigin = 'calendar' | 'reader' | 'editor'
export interface DiaryPresentationFocusTarget {
  kind: 'calendar-date'
  date: DiaryDate
}

export interface DiaryWorkspacePresentationOptions {
  isDiaryScope: Readonly<Ref<boolean>>
  activeHistoryComparison: Readonly<Ref<unknown | null>>
  activeWorkingTreeDiff: Readonly<Ref<unknown | null>>
  activeDraftRecovery: Readonly<Ref<unknown | null>>
  documentPaths: Readonly<Ref<readonly string[]>>
}

/**
 * Own Diary presentation state without becoming another document lifecycle.
 *
 * The backing path is only a presentation reference. Tabs, activePath, route,
 * raw content, save state, and document identity remain owned by Vault's
 * existing workspace lifecycle.
 */
export function useDiaryWorkspacePresentation(options: DiaryWorkspacePresentationOptions) {
  const presentationMode = ref<DiaryPresentationMode>('home')
  const selectedDiaryDate = ref<DiaryDate | null>(null)
  const backingPath = ref<string | null>(null)
  const focusOrigin = ref<DiaryPresentationFocusOrigin | null>(null)
  const focusReturnTarget = ref<DiaryPresentationFocusTarget | null>(null)
  const d5DocumentFallbackActive = ref(false)
  let dateIntentEpoch = 0

  function invalidatePendingDateIntent(): void {
    dateIntentEpoch += 1
  }

  function beginDateIntent(): number {
    invalidatePendingDateIntent()
    return dateIntentEpoch
  }

  function isDateIntentCurrent(intent: number): boolean {
    return intent === dateIntentEpoch
  }

  const diaryPresentationEligible = computed(() => (
    options.isDiaryScope.value
    && !options.activeHistoryComparison.value
    && !options.activeWorkingTreeDiff.value
    && !options.activeDraftRecovery.value
  ))

  const isD5DocumentFallbackActive = computed(() => (
    d5DocumentFallbackActive.value
    && backingPath.value !== null
    && options.documentPaths.value.includes(backingPath.value)
  ))

  const isHome = computed(() => (
    diaryPresentationEligible.value
    && presentationMode.value === 'home'
    && !isD5DocumentFallbackActive.value
  ))
  const isReader = computed(() => (
    diaryPresentationEligible.value && presentationMode.value === 'reader'
  ))
  const isEditor = computed(() => (
    diaryPresentationEligible.value && presentationMode.value === 'editor'
  ))

  function reset(): void {
    invalidatePendingDateIntent()
    presentationMode.value = 'home'
    selectedDiaryDate.value = null
    backingPath.value = null
    focusOrigin.value = null
    focusReturnTarget.value = null
    d5DocumentFallbackActive.value = false
  }

  function closePresentation(): void {
    invalidatePendingDateIntent()
    // Presentation-only close deliberately keeps the backing reference. The
    // document/tab/route lifecycle is not touched here; the reference is
    // useful for future focus restoration when a real Dialog exists.
    presentationMode.value = 'home'
    focusOrigin.value = 'calendar'
  }

  function recordDateCommandResult(result: DiaryDateCommandResult): void {
    if (result.status !== 'opened' && result.status !== 'created') {
      // Failed, future, invalid, and busy intents must never leave a future
      // Dialog state behind.
      reset()
      return
    }

    selectedDiaryDate.value = result.date
    backingPath.value = result.path
    focusOrigin.value = 'calendar'
    focusReturnTarget.value = {
      kind: 'calendar-date',
      date: result.date,
    }
    // D6.1 deliberately keeps the D5 fallback visible. D6.3 will consume
    // this successful command result to request the Reader presentation.
    presentationMode.value = 'home'
    d5DocumentFallbackActive.value = true
  }

  function requestReader(date: DiaryDate, path: string): void {
    if (!diaryPresentationEligible.value) return
    selectedDiaryDate.value = date
    backingPath.value = path
    focusOrigin.value = 'calendar'
    focusReturnTarget.value = {
      kind: 'calendar-date',
      date,
    }
    d5DocumentFallbackActive.value = false
    presentationMode.value = 'reader'
  }

  function requestD5DocumentFallback(): void {
    if (!diaryPresentationEligible.value || !backingPath.value) return
    // D6.3 keeps Edit as a narrow bridge to the existing D5 document/editor
    // surface. This changes presentation only; the backing tab, route, raw,
    // and dirty/save lifecycle remain owned by Vault.
    focusOrigin.value = 'reader'
    presentationMode.value = 'home'
    d5DocumentFallbackActive.value = true
  }

  function requestEditor(): void {
    if (!diaryPresentationEligible.value || !backingPath.value) return
    d5DocumentFallbackActive.value = false
    focusOrigin.value = 'reader'
    presentationMode.value = 'editor'
  }

  // A special Vault surface or a scope exit suspends Diary presentation. The
  // safe default is HOME, so deactivating History/Diff/Recovery never
  // unexpectedly reopens a future Reader/Editor state.
  watch(
    [
      options.isDiaryScope,
      options.activeHistoryComparison,
      options.activeWorkingTreeDiff,
      options.activeDraftRecovery,
    ],
    ([inDiaryScope, historyComparison, workingTreeDiff, draftRecovery]) => {
      if (!inDiaryScope || historyComparison || workingTreeDiff || draftRecovery) reset()
    },
    { flush: 'sync' },
  )

  watch(
    [options.documentPaths, backingPath],
    ([paths, backing]) => {
      if (
        backing
        && !paths.includes(backing)
        && (presentationMode.value === 'reader' || presentationMode.value === 'editor')
      ) reset()
    },
    { flush: 'sync' },
  )

  return {
    presentationMode,
    selectedDiaryDate,
    backingPath,
    focusOrigin,
    focusReturnTarget,
    diaryPresentationEligible,
    isD5DocumentFallbackActive,
    isHome,
    isReader,
    isEditor,
    beginDateIntent,
    isDateIntentCurrent,
    recordDateCommandResult,
    requestReader,
    requestD5DocumentFallback,
    requestEditor,
    closePresentation,
    reset,
  }
}
