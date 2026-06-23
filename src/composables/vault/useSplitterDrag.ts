// Pointer-drag handler for the four vault splitters (left tree, middle
// editor/preview, right TOC, right AI). Lives in its own composable
// rather than inside useVaultLayout so the layout composable stays
// focused on persisted reactive state — drag is a pure DOM concern.
//
// The widths / ratio being mutated are owned by useVaultLayout, so we
// accept a `targets` bag of refs rather than re-creating our own state.
// This keeps the single-source-of-truth invariant: any code that
// mutates sidePanelWidth etc. goes through the same module-level ref
// instance that useVaultLayout's grid + persistence watch read from.

import type { Ref } from 'vue'

export type SplitterWhich = 'tree' | 'middle' | 'ai' | 'toc'

/* Refs the drag handler is allowed to mutate. Pass the same Ref
   instances useVaultLayout returned — that's what makes the grid
   track width update synchronously as the user drags. */
export interface SplitterTargets {
  sidePanelWidth: Ref<number>
  editorRatio: Ref<number>
  aiPanelWidth: Ref<number>
  tocPanelWidth: Ref<number>
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
    const startAi = targets.aiPanelWidth.value
    const startToc = targets.tocPanelWidth.value

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (which === 'tree') {
        const max = Math.min(600, rect.width - 480)
        targets.sidePanelWidth.value = clamp(startTree + dx, 150, max)
      } else if (which === 'toc') {
        const max = Math.min(400, rect.width - 480)
        targets.tocPanelWidth.value = clamp(startToc + dx, 180, max)
      } else if (which === 'ai') {
        // Right-rail drag: dragging the splitter right (positive dx)
        // grows the AI panel, mirroring the tree case. The track is
        // right-anchored in the grid, so the natural sign is +dx.
        // Same max as the tree case: reserve 480px for ab + editor.
        const max = Math.min(600, rect.width - 480)
        targets.aiPanelWidth.value = clamp(startAi + dx, 220, max)
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