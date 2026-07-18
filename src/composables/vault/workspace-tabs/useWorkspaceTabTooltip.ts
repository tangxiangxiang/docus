import {
  nextTick,
  onBeforeUnmount,
  readonly,
  ref,
  watch,
  type Ref,
} from 'vue'

export interface UseWorkspaceTabTooltipOptions {
  activeId: Readonly<Ref<string | null>>
  tabIds: Readonly<Ref<readonly string[]>>
  isSuppressed: () => boolean
}

export function useWorkspaceTabTooltip({
  activeId,
  tabIds,
  isSuppressed,
}: UseWorkspaceTabTooltipOptions) {
  const tooltipTabId = ref<string | null>(null)
  const tooltipStyle = ref<Record<string, string>>({})
  let generation = 0

  function tooltipId(id: string): string {
    return `tab-tooltip-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  }

  function hide(): void {
    generation++
    tooltipTabId.value = null
  }

  function show(tabId: string, anchor: HTMLElement): void {
    if (isSuppressed()) return
    const currentGeneration = ++generation
    tooltipTabId.value = tabId

    const rect = anchor.getBoundingClientRect()
    const margin = 8
    const tooltipMaxWidth = 360
    const plannedWidth = Math.min(tooltipMaxWidth, window.innerWidth - margin * 2)
    let left = rect.left
    if (left + plannedWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - plannedWidth)
    }
    tooltipStyle.value = {
      left: `${Math.round(left)}px`,
      top: `${Math.round(rect.bottom + margin)}px`,
      maxWidth: `${tooltipMaxWidth}px`,
    }

    void nextTick(() => {
      if (
        currentGeneration !== generation
        || tooltipTabId.value !== tabId
      ) return

      const element = document.getElementById(tooltipId(tabId))
      if (!element) return
      const actual = element.getBoundingClientRect()
      const currentLeft = Number.parseInt(tooltipStyle.value.left ?? '0', 10)
      if (currentLeft + actual.width > window.innerWidth - margin) {
        const nextLeft = Math.max(
          margin,
          Math.round(window.innerWidth - margin - actual.width),
        )
        tooltipStyle.value = { ...tooltipStyle.value, left: `${nextLeft}px` }
      } else if (currentLeft < margin) {
        tooltipStyle.value = { ...tooltipStyle.value, left: `${margin}px` }
      }
    })
  }

  function handleEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') hide()
  }

  watch(activeId, hide)
  watch(tabIds, (ids) => {
    if (tooltipTabId.value && !ids.includes(tooltipTabId.value)) hide()
  })
  onBeforeUnmount(hide)

  return {
    tooltipTabId: readonly(tooltipTabId),
    tooltipStyle: readonly(tooltipStyle),
    tooltipId,
    show,
    hide,
    handleEscape,
  }
}
