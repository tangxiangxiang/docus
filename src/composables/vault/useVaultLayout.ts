// Shared vault layout state. TOC, links, and AI are views of one
// persistent right rail with one width and one collapsed state.
//
// The composable owns:
//   - module-level reactive refs so NavBar and VaultView share state
//   - the useStorage hydration + the load-bearing old-schema migration
//     (fileTreeOpen / fileTreeWidth -> activePanel / sidePanelWidth)
//   - the single watcher that bridges live refs -> persisted state
//   - the two computed styles (vaultStyle for the outer grid, contentStyle
//     for the editor/preview flex vars)
//
// Pointer-drag handling lives in `useSplitterDrag` (separate file) —
// it imports nothing here, the caller passes the width/ratio refs in.
//
// `pathToUrl` is NOT here: it is a pure string concatenation with no
// reactive dependency, so it stays as a one-liner in VaultView.vue (it's
// only used by the tabs composable's openPost/closeTab/selectTab, which
// all live in the same file).
//
// The `useStorage` key ('docus.vault.layout') and the migration shape
// must NOT change — existing users' localStorage has the new shape, and
// older installs may still have {fileTreeOpen, fileTreeWidth}.
//
import { computed, ref, watch, type Ref } from 'vue'
import { useStorage } from '@vueuse/core'
import type { SidePanel } from '../../components/vault/ActivityBar.vue'

export type ActivePanel = SidePanel | null
export type RightRailTab = 'toc' | 'links' | 'ai'

export interface VaultLayout {
  activePanel: ActivePanel
  sidePanelWidth: number
  editorRatio: number
  rightRailTab: RightRailTab
  rightRailWidth: number
  /* Whether the unified right rail is collapsed by user choice. */
  rightRailCollapsed: boolean
}

const STORAGE_KEY = 'docus.vault.layout'
const DEFAULTS: VaultLayout = {
  activePanel: 'files',
  sidePanelWidth: 260,
  editorRatio: 1,
  rightRailTab: 'toc',
  rightRailWidth: 360,
  rightRailCollapsed: false,
}

/* Module-level shared refs.
   NavBar (in the navbar above the router view) and VaultView (the
   router view) both call useVaultLayout(). Each call would normally
   create its own layout refs, and the two would only stay
   in sync via the round-trip through localStorage. That round-trip is
   async (useStorage's writer is next-tick), which is fine for the
   first mount but breaks reactivity: when NavBar.toggleAi() mutates
   its local state, VaultView's watcher doesn't see
   the change — only the localStorage-sync watcher does, and only on
   the next tick. That was the original bug: closing the AI panel in
   NavBar did not re-open the TOC in VaultView.

   By making the per-field refs module-level (the same pattern as
   `tocHeadings` in useTocState), every consumer of useVaultLayout()
   reads and writes the same Ref instances. No localStorage round-trip
   needed for runtime mutation, and watchers fire synchronously across
   consumers. localStorage is still the persistence boundary; it's
   driven by a single watcher below. */
const _activePanel = ref<ActivePanel>(DEFAULTS.activePanel)
const _sidePanelWidth = ref(DEFAULTS.sidePanelWidth)
const _editorRatio = ref(DEFAULTS.editorRatio)
const _rightRailTab = ref<RightRailTab>(DEFAULTS.rightRailTab)
const _rightRailWidth = ref(DEFAULTS.rightRailWidth)
const _rightRailCollapsed = ref(DEFAULTS.rightRailCollapsed)

/* Hydration guard. The first useVaultLayout() call (which is the
   VaultView's) is the one that owns the storage round-trip — it reads
   the persisted payload into the module-level refs and installs the
   writer. Subsequent callers (e.g. NavBar) just receive the same Ref
   instances. */
let _hydrated = false

/* Test-only reset. Restores the module-level refs to their defaults
   and clears the hydration guard so the next useVaultLayout() call
   re-runs the localStorage hydration step. The persistent writer is
   left in place; it's harmless in the next mount because it re-runs
   once and reattaches. */
export function __resetVaultLayoutState(): void {
  _hydrated = false
  _activePanel.value = DEFAULTS.activePanel
  _sidePanelWidth.value = DEFAULTS.sidePanelWidth
  _editorRatio.value = DEFAULTS.editorRatio
  _rightRailTab.value = DEFAULTS.rightRailTab
  _rightRailWidth.value = DEFAULTS.rightRailWidth
  _rightRailCollapsed.value = DEFAULTS.rightRailCollapsed
}

export function useVaultLayout() {
  // useStorage handles the deep-compare-and-skip-noop write for us, so the
  // bidirectional watcher below doesn't ping-pong on rehydration. The
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
          if (ap === 'graph') active = 'files'
          else if (ap === 'files' || ap === 'tags' || ap === 'history' || ap === null) active = ap as ActivePanel
          else if (typeof d.fileTreeOpen === 'boolean') active = d.fileTreeOpen ? 'files' : null
          const w = typeof d.sidePanelWidth === 'number'
            ? d.sidePanelWidth
            : typeof d.fileTreeWidth === 'number' ? d.fileTreeWidth : DEFAULTS.sidePanelWidth
          const r = typeof d.editorRatio === 'number' ? d.editorRatio : DEFAULTS.editorRatio
          const legacyAiOpen = d.aiOpen === true
          const storedTab = d.rightRailTab
          const rightRailTab: RightRailTab = legacyAiOpen
            ? 'ai'
            : storedTab === 'links' || storedTab === 'ai' ? storedTab : 'toc'
          const rightRailWidth = typeof d.rightRailWidth === 'number'
            ? d.rightRailWidth
            : typeof d.aiPanelWidth === 'number' ? d.aiPanelWidth
            : typeof d.tocPanelWidth === 'number' ? d.tocPanelWidth
            : DEFAULTS.rightRailWidth
          return {
            activePanel: active,
            sidePanelWidth: w,
            editorRatio: r,
            rightRailTab,
            rightRailWidth: Math.max(320, Math.min(520, rightRailWidth)),
            // Missing means expanded. The AI toolbar toggle is now the
            // only control that collapses the unified rail.
            rightRailCollapsed: legacyAiOpen ? false : typeof d.rightRailCollapsed === 'boolean' ? d.rightRailCollapsed : DEFAULTS.rightRailCollapsed,
          } satisfies VaultLayout
        } catch {
          return { ...DEFAULTS }
        }
      },
      write: (v) => JSON.stringify(v),
    },
  })

  /* The live refs are MODULE-LEVEL (see comment block above the
     ref declarations). The very first call to useVaultLayout() (which
     is the VaultView's setup) hydrates the module-level refs from the
     persisted payload, and registers a writer that persists back. Later
     callers (e.g. NavBar) get the same Ref instances. */
  if (!_hydrated) {
    _hydrated = true
    _activePanel.value = layout.value.activePanel
    _sidePanelWidth.value = layout.value.sidePanelWidth
    _editorRatio.value = layout.value.editorRatio
    _rightRailTab.value = layout.value.rightRailTab
    _rightRailWidth.value = layout.value.rightRailWidth
    _rightRailCollapsed.value = layout.value.rightRailCollapsed

    // Persist on any change. useStorage's deep-compare avoids noop writes
    // (e.g. when the storage value already matches), so the round-trip
    // doesn't cause re-render storms.
    watch(
      [_activePanel, _sidePanelWidth, _editorRatio, _rightRailTab, _rightRailWidth, _rightRailCollapsed],
      ([ap, w, r, tab, rw, rrc]) => {
        layout.value = { activePanel: ap, sidePanelWidth: w, editorRatio: r, rightRailTab: tab, rightRailWidth: rw, rightRailCollapsed: rrc }
      },
    )
  }

  /* Exposed as a top-level ref so the template can use it for the
     side-splitter's v-show. */
  const sidePanelOpen = computed(() =>
    _activePanel.value === 'files' ||
    _activePanel.value === 'tags' ||
    _activePanel.value === 'history',
  )
  const activePanel: Ref<ActivePanel> = _activePanel
  const sidePanelWidth: Ref<number> = _sidePanelWidth
  const editorRatio: Ref<number> = _editorRatio
  const rightRailTab: Ref<RightRailTab> = _rightRailTab
  const rightRailWidth: Ref<number> = _rightRailWidth
  const rightRailCollapsed: Ref<boolean> = _rightRailCollapsed

  const vaultStyle = computed(() => {
    // Rows: editor-area (fills), then a 24px status-bar that spans the
    // full width. Columns vary depending on whether the left side panel,
    // the TOC panel, and/or the right AI panel are open. The splitter
    // grid track is 1px (matches .vault .splitter { width: 1px }); the
    // actual grabbable area is wider (7px) but that lives on a
    // transparent ::before that overflows the layout box.
    //
    // The left side panel is the file tree, tag panel, or history panel.
    //
    // The right-rail panel sits on the right (between editor-area and
    // AI panel) when the external gate says it would render —
    // VaultView passes `isReadMode` so the rail tracks read mode,
    // not whether the document has headings (the TOC half inside the
    // rail gates on headings itself; the Links half does not). Hidden
    // when the AI panel opens (only one auxiliary panel at a time
    // on the right). Side panel and rail coexist — the user routinely
    // reads with the file tree open on the left, and the side+rail
    // combined width (~580px) leaves plenty of room for the editor
    // area.
    //
    // Column tracks (TOC+AI combination is elided — toc goes off when
    // ai opens):
    //   side=off toc=off ai=off → 48px 1fr
    //   side=on  toc=off ai=off → 48px {side}px 1px 1fr
    //   side=off toc=on  ai=off → 48px 1fr 1px {toc}px
    //   side=on  toc=on  ai=off → 48px {side}px 1px 1fr 1px {toc}px
    //   side=off toc=off ai=on  → 48px 1fr 1px {ai}px
    //   side=on  toc=off ai=on  → 48px {side}px 1px 1fr 1px {ai}px
    // Trailing space on `left` and leading space on `right`/`toc`
    // are load-bearing — they separate the splitter tracks from
    // `1fr` in the template literal below. Don't normalize the
    // whitespace.
    const left = sidePanelOpen.value ? `${sidePanelWidth.value}px 1px ` : ''
    const right = !rightRailCollapsed.value ? ` 1px ${rightRailWidth.value}px` : ''
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
    if (!rightRailCollapsed.value && rightRailTab.value === 'ai') rightRailCollapsed.value = true
    else {
      rightRailTab.value = 'ai'
      rightRailCollapsed.value = false
    }
  }

  return {
    activePanel,
    sidePanelOpen,
    sidePanelWidth,
    editorRatio,
    rightRailTab,
    rightRailWidth,
    rightRailCollapsed,
    vaultStyle,
    contentStyle,
    selectPanel,
    toggleAi,
  }
}
