import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { parseDiaryDate, type DiaryDate } from '../../../../shared/diaryProtocol'
import { useDiaryWorkspacePresentation } from '../useDiaryWorkspacePresentation'

function date(value: string): DiaryDate {
  const parsed = parseDiaryDate(value)
  if (!parsed) throw new Error(`invalid test date: ${value}`)
  return parsed
}

function setup() {
  const isDiaryScope = ref(false)
  const activeHistoryComparison = ref<unknown | null>(null)
  const activeWorkingTreeDiff = ref<unknown | null>(null)
  const activeDraftRecovery = ref<unknown | null>(null)
  const documentPaths = ref<string[]>([])
  const presentation = useDiaryWorkspacePresentation({
    isDiaryScope,
    activeHistoryComparison,
    activeWorkingTreeDiff,
    activeDraftRecovery,
    documentPaths,
  })

  return {
    isDiaryScope,
    activeHistoryComparison,
    activeWorkingTreeDiff,
    activeDraftRecovery,
    documentPaths,
    presentation,
  }
}

describe('useDiaryWorkspacePresentation', () => {
  it('starts at HOME and is eligible only for a plain Diary scope', async () => {
    const state = setup()

    expect(state.presentation.presentationMode.value).toBe('home')
    expect(state.presentation.diaryPresentationEligible.value).toBe(false)
    expect(state.presentation.isHome.value).toBe(false)

    state.isDiaryScope.value = true
    await nextTick()

    expect(state.presentation.diaryPresentationEligible.value).toBe(true)
    expect(state.presentation.isHome.value).toBe(true)
  })

  it.each([
    ['History Comparison', 'activeHistoryComparison'],
    ['Working Tree Diff', 'activeWorkingTreeDiff'],
    ['Recovery', 'activeDraftRecovery'],
  ] as const)('yields to an active %s without changing its owner', async (_label, key) => {
    const state = setup()
    state.isDiaryScope.value = true
    await nextTick()

    state.presentation.requestReader(date('2026-08-24'), 'diary/2026-08-24')
    expect(state.presentation.presentationMode.value).toBe('reader')

    state[key].value = { active: true }
    await nextTick()

    expect(state.presentation.diaryPresentationEligible.value).toBe(false)
    expect(state.presentation.presentationMode.value).toBe('home')
    expect(state.presentation.selectedDiaryDate.value).toBeNull()

    state[key].value = null
    await nextTick()

    expect(state.presentation.diaryPresentationEligible.value).toBe(true)
    expect(state.presentation.isHome.value).toBe(true)
    expect(state.presentation.presentationMode.value).toBe('home')
  })

  it('records successful date intent without opening a Dialog in D6.1', async () => {
    const state = setup()
    state.isDiaryScope.value = true
    await nextTick()

    state.presentation.recordDateCommandResult({
      status: 'created',
      date: date('2026-08-24'),
      path: 'diary/2026-08-24',
    })

    expect(state.presentation.presentationMode.value).toBe('home')
    expect(state.presentation.isHome.value).toBe(true)
    expect(state.presentation.selectedDiaryDate.value).toBe('2026-08-24')
    expect(state.presentation.backingPath.value).toBe('diary/2026-08-24')
    expect(state.presentation.focusOrigin.value).toBe('calendar')
  })

  it('keeps the existing D5 document fallback only while the backing tab exists', async () => {
    const state = setup()
    state.isDiaryScope.value = true
    await nextTick()

    state.presentation.recordDateCommandResult({
      status: 'opened',
      date: date('2026-08-24'),
      path: 'diary/2026-08-24',
    })
    state.documentPaths.value = ['diary/2026-08-24']
    await nextTick()

    expect(state.presentation.isD5DocumentFallbackActive.value).toBe(true)
    expect(state.presentation.isHome.value).toBe(false)

    state.documentPaths.value = []
    await nextTick()

    expect(state.presentation.isD5DocumentFallbackActive.value).toBe(false)
    expect(state.presentation.isHome.value).toBe(true)
  })

  it.each([
    'future',
    'invalid',
    'busy',
    'error',
  ] as const)('does not leave Dialog state after a %s date result', async (status) => {
    const state = setup()
    state.isDiaryScope.value = true
    await nextTick()
    state.presentation.requestReader(date('2026-08-24'), 'diary/2026-08-24')

    state.presentation.recordDateCommandResult({ status })

    expect(state.presentation.presentationMode.value).toBe('home')
    expect(state.presentation.selectedDiaryDate.value).toBeNull()
    expect(state.presentation.backingPath.value).toBeNull()
  })

  it('keeps the backing reference for presentation-only close and resets on scope exit', async () => {
    const state = setup()
    state.isDiaryScope.value = true
    await nextTick()
    state.presentation.recordDateCommandResult({
      status: 'opened',
      date: date('2026-08-25'),
      path: 'diary/2026-08-25',
    })
    state.presentation.requestReader(date('2026-08-25'), 'diary/2026-08-25')
    state.presentation.closePresentation()

    expect(state.presentation.presentationMode.value).toBe('home')
    expect(state.presentation.backingPath.value).toBe('diary/2026-08-25')

    state.isDiaryScope.value = false
    await nextTick()

    expect(state.presentation.presentationMode.value).toBe('home')
    expect(state.presentation.selectedDiaryDate.value).toBeNull()
    expect(state.presentation.backingPath.value).toBeNull()
  })

  it('does not use an active-path-like input as a Dialog intent', async () => {
    const state = setup()
    state.isDiaryScope.value = true
    await nextTick()

    // The presentation owner has no activePath input. A document selection
    // therefore cannot transition it out of HOME.
    expect(state.presentation.presentationMode.value).toBe('home')
    expect(state.presentation.isReader.value).toBe(false)
    expect(state.presentation.isEditor.value).toBe(false)
  })
})
