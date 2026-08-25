import { computed, ref, watch, type Ref } from 'vue'
import type { DiaryDate } from '../../../shared/diaryProtocol'
import type { DiaryDateCommandResult } from './useDiaryDateCommand'

export type DiaryPresentationMode = 'home' | 'reader' | 'editor'
export type DiaryPresentationFocusOrigin = 'calendar' | 'reader' | 'editor'

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
  const d5DocumentFallbackActive = ref(false)

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
    presentationMode.value = 'home'
    selectedDiaryDate.value = null
    backingPath.value = null
    focusOrigin.value = null
    d5DocumentFallbackActive.value = false
  }

  function closePresentation(): void {
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
    d5DocumentFallbackActive.value = false
    presentationMode.value = 'reader'
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
    [options.isDiaryScope, diaryPresentationEligible],
    ([inDiaryScope, eligible]) => {
      if (!inDiaryScope || !eligible) reset()
    },
  )

  return {
    presentationMode,
    selectedDiaryDate,
    backingPath,
    focusOrigin,
    diaryPresentationEligible,
    isD5DocumentFallbackActive,
    isHome,
    isReader,
    isEditor,
    recordDateCommandResult,
    requestReader,
    requestEditor,
    closePresentation,
    reset,
  }
}
