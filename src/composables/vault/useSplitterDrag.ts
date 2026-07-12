// Pointer-drag handler for the three vault splitters (left tree, middle
// editor/preview, unified right rail). Lives in its own composable
// rather than inside useVaultLayout so the layout composable stays
// focused on persisted reactive state — drag is a pure DOM concern.
//
// The widths / ratio being mutated are owned by useVaultLayout, so we
// accept a `targets` bag of refs rather than re-creating our own state.
// This keeps the single-source-of-truth invariant: any code that
// mutates sidePanelWidth etc. goes through the same module-level ref
// instance that useVaultLayout's grid + persistence watch read from.

import type { Ref } from 'vue'

export type SplitterWhich = 'tree' | 'middle' | 'rightRail'

/* Refs the drag handler is allowed to mutate. Pass the same Ref
   instances useVaultLayout returned — that's what makes the grid
   track width update synchronously as the user drags. */
export interface SplitterTargets {
  sidePanelWidth: Ref<number>
  editorRatio: Ref<number>
  rightRailWidth: Ref<number>
}

// Must match the splitter's layout width in .vault .splitter { width: 1px }
// and the .content flex track the mid-splitter sits in. The 7px hit area
// (::before) is purely for grabbing and doesn't affect this math.
const SPLITTER_PX = 1

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function useSplitterDrag(targets: SplitterTargets) {
  function startDrag(host: HTMLElement, which: SplitterWhich, e: PointerEvent) {
    e.preventDefault()
    const rect = host.getBoundingClientRect()
    const startX = e.clientX
    const startTree = targets.sidePanelWidth.value
    const startRatio = targets.editorRatio.value
    const startRightRail = targets.rightRailWidth.value

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (which === 'tree') {
        /* Left-anchored column (`.vault` grid template starts with
           `48px {side}px …`). The splitter is the column's RIGHT
           edge, so dragging right (positive dx) moves that edge
           outward → panel grows. */
        const max = Math.min(600, rect.width - 480)
        targets.sidePanelWidth.value = clamp(startTree + dx, 150, max)
      } else if (which === 'rightRail') {
        /* Right-anchored column (grid template ends with `… 1fr 1px
           {rightRail}px`). The splitter is the column's LEFT edge, and
           the right edge is the vault's right border — fixed.
           Dragging right (positive dx) moves the left edge right →
           column shrinks. So we SUBTRACT dx. */
        const max = Math.min(520, rect.width - 480)
        targets.rightRailWidth.value = clamp(startRightRail - dx, 320, max)
      } else {
        const content = host.querySelector<HTMLElement>('.content')
        const total = content ? content.clientWidth - SPLITTER_PX : 0
        if (total <= 0) return
        const startEditor = (total * startRatio) / (1 + startRatio)
        const editorWidth = clamp(startEditor + dx, total * 0.2, total * 0.8)
        targets.editorRatio.value = editorWidth / (total - editorWidth)
      }
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  return { startDrag }
}
