// Vault layout state: which side panel is open (Files / Tags / none), the
// side-panel width, the editor/preview split ratio, the right-rail AI
// panel state, and the pointer-based splitter dragging logic. All
// persisted to localStorage via `useStorage`.
//
// The composable owns:
//   - the five reactive refs (activePanel, sidePanelWidth, editorRatio,
//     aiOpen, aiPanelWidth)
//   - the useStorage hydration + the load-bearing old-schema migration
//     (fileTreeOpen / fileTreeWidth -> activePanel / sidePanelWidth)
//   - the two watchers that bridge live refs <-> persisted state
//   - the vaultRef template ref (returned to the caller, bound by the
//     template via :ref="(el) => (layout.vaultRef.value = el)")
//   - the two computed styles (vaultStyle for the outer grid, contentStyle
//     for the editor/preview flex vars)
//   - the two pointer-drag handlers and the small clamp helper
//
// `pathToUrl` is NOT here: it is a pure string concatenation with no
// reactive dependency, so it stays as a one-liner in VaultView.vue (it's
// only used by the tabs composable's openPost/closeTab/selectTab, which
// all live in the same file).
//
// The `useStorage` key ('docus.vault.layout') and the migration shape
// must NOT change — existing users' localStorage has the new shape, and
// older installs may still have {fileTreeOpen, fileTreeWidth}.

import { computed, ref, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import type { SidePanel } from '../../components/vault/ActivityBar.vue'

export type ActivePanel = SidePanel | null

export interface VaultLayout {
  activePanel: ActivePanel
  sidePanelWidth: number
  editorRatio: number
  aiOpen: boolean
  aiPanelWidth: number
}

const STORAGE_KEY = 'docus.vault.layout'
const DEFAULTS: VaultLayout = { activePanel: 'files', sidePanelWidth: 260, editorRatio: 1, aiOpen: false, aiPanelWidth: 320 }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function useVaultLayout() {
  // useStorage handles the deep-compare-and-skip-noop write for us, so the
  // bidirectional watchers below don't ping-pong on rehydration. The
  // serializer.read keeps the old {fileTreeOpen, fileTreeWidth} shape
  // working — if a user upgrades from a build that used the old keys, the
  // next read translates them into the new shape and from then on writes
  // the new shape only.
  const layout = useStorage(STORAGE_KEY, DEFAULTS, undefined, {
    serializer: {
      read: (raw) => {
        try {
          const d = JSON.parse(raw) as Record<string, unknown>
          const ap = d.activePanel
          let active: ActivePanel = null
          if (ap === 'files' || ap === 'tags' || ap === null) active = ap as ActivePanel
          else if (typeof d.fileTreeOpen === 'boolean') active = d.fileTreeOpen ? 'files' : null
          const w = typeof d.sidePanelWidth === 'number'
            ? d.sidePanelWidth
            : typeof d.fileTreeWidth === 'number' ? d.fileTreeWidth : DEFAULTS.sidePanelWidth
          const r = typeof d.editorRatio === 'number' ? d.editorRatio : DEFAULTS.editorRatio
          return {
            activePanel: active,
            sidePanelWidth: w,
            editorRatio: r,
            aiOpen: typeof d.aiOpen === 'boolean' ? d.aiOpen : DEFAULTS.aiOpen,
            aiPanelWidth: typeof d.aiPanelWidth === 'number' ? d.aiPanelWidth : DEFAULTS.aiPanelWidth,
          } satisfies VaultLayout
        } catch {
          return { ...DEFAULTS }
        }
      },
      write: (v) => JSON.stringify(v),
    },
  })

  // The five live refs mirror the persisted layout. The watchers below
  // keep them in sync in both directions; useStorage is the source of
  // truth for initial hydration, then the refs take over for runtime
  // mutations and we write back on every change.
  const activePanel = ref<ActivePanel>(layout.value.activePanel)
  const sidePanelWidth = ref(layout.value.sidePanelWidth)
  const editorRatio = ref(layout.value.editorRatio)
  const aiOpen = ref(layout.value.aiOpen)
  const aiPanelWidth = ref(layout.value.aiPanelWidth)

  watch(layout, (v) => {
    activePanel.value = v.activePanel
    sidePanelWidth.value = v.sidePanelWidth
    editorRatio.value = v.editorRatio
    aiOpen.value = v.aiOpen
    aiPanelWidth.value = v.aiPanelWidth
  }, { immediate: true, deep: true })

  watch([activePanel, sidePanelWidth, editorRatio, aiOpen, aiPanelWidth], ([ap, w, r, ao, aw]) => {
    layout.value = { activePanel: ap, sidePanelWidth: w, editorRatio: r, aiOpen: ao, aiPanelWidth: aw }
  })

  const vaultStyle = computed(() => {
    // Rows: editor-area (fills), then a 24px status-bar that spans the
    // full width. Columns vary depending on whether the left side panel
    // and/or the right AI panel are open. The splitter grid track is
    // 1px (matches .vault .splitter { width: 1px }); the actual
    // grabbable area is wider (7px) but that lives on a transparent
    // ::before that overflows the layout box.
    //
    // The four possible column tracks:
    //   side=off  ai=off → 48px 1fr
    //   side=on   ai=off → 48px {side}px 1px 1fr
    //   side=off  ai=on  → 48px 1fr 1px {ai}px
    //   side=on   ai=on  → 48px {side}px 1px 1fr 1px {ai}px
    // Trailing space on `left` and leading space on `right` are
    // load-bearing — they separate the splitter tracks from `1fr` in
    // the template literal below. Don't normalize the whitespace.
    const left = activePanel.value ? `${sidePanelWidth.value}px 1px ` : ''
    const right = aiOpen.value ? ` 1px ${aiPanelWidth.value}px` : ''
    return {
      gridTemplateColumns: `48px ${left}1fr${right}`,
      gridTemplateRows: '1fr 24px',
    }
  })
  const contentStyle = computed(() => ({
    '--editor-flex': String(editorRatio.value),
    '--preview-flex': '1',
  }))

  // Template ref to the outer .vault element lives in VaultView.vue (so
  // vue-tsc is happy with the `ref="..."` string template binding). We
  // accept it as a parameter to startDrag so this composable does not
  // have to assume a particular ref name or be the owner of the DOM node.

  function selectPanel(panel: SidePanel) {
    activePanel.value = activePanel.value === panel ? null : panel
  }

  function toggleAi() {
    aiOpen.value = !aiOpen.value
  }

  function startDrag(host: HTMLElement, which: 'tree' | 'middle' | 'ai', e: PointerEvent) {
    e.preventDefault()
    const rect = host.getBoundingClientRect()
    const startX = e.clientX
    const startTree = sidePanelWidth.value
    const startRatio = editorRatio.value
    const startAi = aiPanelWidth.value
    // Must match the splitter's layout width in .vault .splitter { width: 1px }
    // and the .content flex track the mid-splitter sits in. The 7px hit area
    // (::before) is purely for grabbing and doesn't affect this math.
    const SPLITTER_PX = 1

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (which === 'tree') {
        const max = Math.min(600, rect.width - 480)
        sidePanelWidth.value = clamp(startTree + dx, 150, max)
      } else if (which === 'ai') {
        // Right-rail drag: dragging the splitter right (positive dx)
        // grows the AI panel, mirroring the tree case. The track is
        // right-anchored in the grid, so the natural sign is +dx.
        // Same max as the tree case: reserve 480px for ab + editor.
        const max = Math.min(600, rect.width - 480)
        aiPanelWidth.value = clamp(startAi + dx, 220, max)
      } else {
        const content = host.querySelector<HTMLElement>('.content')
        const total = content ? content.clientWidth - SPLITTER_PX : 0
        if (total <= 0) return
        const startEditor = (total * startRatio) / (1 + startRatio)
        const editorWidth = clamp(startEditor + dx, total * 0.2, total * 0.8)
        editorRatio.value = editorWidth / (total - editorWidth)
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

  return {
    activePanel,
    sidePanelWidth,
    editorRatio,
    aiOpen,
    aiPanelWidth,
    vaultStyle,
    contentStyle,
    selectPanel,
    toggleAi,
    startDrag,
  }
}
