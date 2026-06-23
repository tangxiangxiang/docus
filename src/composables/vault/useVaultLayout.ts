// Vault layout state: which side panel is open (Files / Tags / none), the
// side-panel width, the editor/preview split ratio, the right-rail AI
// panel state, and the right-rail TOC panel width. All persisted to
// localStorage via `useStorage`.
//
// The TOC panel's *visibility* (whether to render it at all) is NOT
// persisted — read mode + having headings is the only meaningful state,
// and that lives in VaultView's `tocPanelEnabled` computed. The TOC
// panel width IS persisted (the user drags the splitter).
//
// The composable owns:
//   - the six reactive refs (activePanel, sidePanelWidth, editorRatio,
//     aiOpen, aiPanelWidth, tocPanelWidth) — all module-level so NavBar
//     and VaultView see the same instances (see comment block above the
//     ref declarations)
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
// Cross-component call into the layout:
//   useVaultLayout is a per-mount composable — every call creates its
//   own activePanel ref, which means a child component invoking
//   `useVaultLayout()` would get a SECOND, disconnected set of refs.
//   The child (KnowledgeGraph.vue, when a node is clicked) needs to
//   tell the parent vault to switch panels, so we publish the parent's
//   selectPanel via a module-level slot. The same pattern is used for
//   openPost in useEditorTabs. This avoids the cycle of having the
//   child import the parent's layout instance.

import { computed, ref, toRef, watch, type Ref, type MaybeRefOrGetter } from 'vue'
import { useStorage } from '@vueuse/core'
import type { SidePanel } from '../../components/vault/ActivityBar.vue'

export type ActivePanel = SidePanel | null

export interface VaultLayout {
  activePanel: ActivePanel
  sidePanelWidth: number
  editorRatio: number
  aiOpen: boolean
  aiPanelWidth: number
  tocPanelWidth: number
}

const STORAGE_KEY = 'docus.vault.layout'
const DEFAULTS: VaultLayout = { activePanel: 'files', sidePanelWidth: 260, editorRatio: 1, aiOpen: false, aiPanelWidth: 320, tocPanelWidth: 320 }

/* Module-level shared refs.
   NavBar (in the navbar above the router view) and VaultView (the
   router view) both call useVaultLayout(). Each call would normally
   create its own aiOpen/etc refs, and the two would only stay
   in sync via the round-trip through localStorage. That round-trip is
   async (useStorage's writer is next-tick), which is fine for the
   first mount but breaks reactivity: when NavBar.toggleAi() mutates
   its local aiOpen ref, VaultView's `watch(aiOpen, ...)` doesn't see
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
const _aiOpen = ref(DEFAULTS.aiOpen)
const _aiPanelWidth = ref(DEFAULTS.aiPanelWidth)
const _tocPanelWidth = ref(DEFAULTS.tocPanelWidth)

/* Hydration guard. The first useVaultLayout() call (which is the
   VaultView's) is the one that owns the storage round-trip — it reads
   the persisted payload into the module-level refs and installs the
   writer. Subsequent callers (e.g. NavBar) just receive the same Ref
   instances. */
let _hydrated = false

/* Cross-component call slot. See the comment block at the top of the
   file for the full reasoning. Set once by the first useVaultLayout()
   call (which is the parent's), and read by child components that need
   to switch the activity-bar panel (e.g. KnowledgeGraph closing the
   graph panel when a node is clicked). */
let _selectPanelForClicks: ((panel: SidePanel) => void) | null = null

export function setSelectPanelForClicks(fn: ((panel: SidePanel) => void) | null): void {
  _selectPanelForClicks = fn
}

export function getSelectPanelForClicks(): ((panel: SidePanel) => void) | null {
  return _selectPanelForClicks
}

export function __resetSelectPanelForClicks(): void {
  _selectPanelForClicks = null
}

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
  _aiOpen.value = DEFAULTS.aiOpen
  _aiPanelWidth.value = DEFAULTS.aiPanelWidth
  _tocPanelWidth.value = DEFAULTS.tocPanelWidth
}

export function useVaultLayout(opts: { tocGate?: () => boolean } = {}) {
  // External visibility gate for the right-rail column. useVaultLayout
  // owns the persisted tocPanelWidth state, but it doesn't know
  // whether the rail is *currently* meaningful — that's a view-mode
  // concern owned by VaultView (read mode + AI closed + not graph).
  // The grid must elide the rail track when the panel isn't going to
  // render, otherwise an invisible 320px column sits at the right of
  // the vault (the v-if hides <TocPanel> but the grid template still
  // allocates the column).
  //
  // Accepting a `() => boolean` getter (not a Ref) sidesteps a setup-
  // order cycle: VaultView's gate depends on `activePanel`, which is
  // destructured out of this composable. Passing a getter lets the
  // caller capture `activePanel` by closure and defer evaluation
  // until vaultStyle first reads it — by which point setup has
  // finished and the binding is live. The default `() => true` keeps
  // the composable usable for callers that don't gate on view mode
  // (the existing test harness, NavBar).
  const tocGate: () => boolean = opts.tocGate ?? (() => true)
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
          if (ap === 'files' || ap === 'tags' || ap === 'graph' || ap === null) active = ap as ActivePanel
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
            tocPanelWidth: typeof d.tocPanelWidth === 'number' ? d.tocPanelWidth : DEFAULTS.tocPanelWidth,
          } satisfies VaultLayout
        } catch {
          return { ...DEFAULTS }
        }
      },
      write: (v) => JSON.stringify(v),
    },
  })

  /* The six live refs are MODULE-LEVEL (see comment block above the
     ref declarations). The very first call to useVaultLayout() (which
     is the VaultView's setup) hydrates the module-level refs from the
     persisted payload, and registers a writer that persists back. Later
     callers (e.g. NavBar) get the same Ref instances. */
  if (!_hydrated) {
    _hydrated = true
    _activePanel.value = layout.value.activePanel
    _sidePanelWidth.value = layout.value.sidePanelWidth
    _editorRatio.value = layout.value.editorRatio
    _aiOpen.value = layout.value.aiOpen
    _aiPanelWidth.value = layout.value.aiPanelWidth
    _tocPanelWidth.value = layout.value.tocPanelWidth

    // Persist on any change. useStorage's deep-compare avoids noop writes
    // (e.g. when the storage value already matches), so the round-trip
    // doesn't cause re-render storms.
    watch(
      [_activePanel, _sidePanelWidth, _editorRatio, _aiOpen, _aiPanelWidth, _tocPanelWidth],
      ([ap, w, r, ao, aw, tw]) => {
        layout.value = { activePanel: ap, sidePanelWidth: w, editorRatio: r, aiOpen: ao, aiPanelWidth: aw, tocPanelWidth: tw }
      },
    )
  }

  /* The "side panel" is the file tree / tag panel / links panel. Graph
     mode does NOT count — the graph panel is rendered inside
     .editor-area, not next to the activity bar, so it must not steal a
     grid column from the editor surface. Exposed as a top-level ref
     so the template can use it for the side-splitter's v-show. */
  const sidePanelOpen = computed(() =>
    _activePanel.value === 'files' ||
    _activePanel.value === 'tags',
  )
  const activePanel: Ref<ActivePanel> = _activePanel
  const sidePanelWidth: Ref<number> = _sidePanelWidth
  const editorRatio: Ref<number> = _editorRatio
  const aiOpen: Ref<boolean> = _aiOpen
  const aiPanelWidth: Ref<number> = _aiPanelWidth
  const tocPanelWidth: Ref<number> = _tocPanelWidth

  const vaultStyle = computed(() => {
    // Rows: editor-area (fills), then a 24px status-bar that spans the
    // full width. Columns vary depending on whether the left side panel,
    // the TOC panel, and/or the right AI panel are open. The splitter
    // grid track is 1px (matches .vault .splitter { width: 1px }); the
    // actual grabbable area is wider (7px) but that lives on a
    // transparent ::before that overflows the layout box.
    //
    // The "side panel" is only the file tree / tag panel / links panel.
    // `activePanel === 'graph'` does NOT mean a side panel is open — the
    // graph replaces the editor surface inside .editor-area (it lives in
    // the `1fr` column, not next to the activity bar). Treating graph as
    // a side panel would push .editor-area into a 1px column and the
    // force-graph canvas would have nowhere to render. So the left track
    // is keyed on the three side-panel modes, not on `activePanel`.
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
    // The TOC track is emitted only when the TOC panel would actually
    // render — the external gate (tocGate) reflects "would VaultView
    // render <TocPanel> right now?". Without this, a user in edit mode
    // would see a 320px gray column on the right because the grid
    // allocates the track even though the v-if hides the element.
    // tocGate is a getter (not a Ref) so it captures activePanel by
    // closure — see useVaultLayout's signature comment.
    const toc = (!aiOpen.value && tocGate()) ? ` 1px ${tocPanelWidth.value}px` : ''
    const right = aiOpen.value ? ` 1px ${aiPanelWidth.value}px` : ''
    return {
      gridTemplateColumns: `48px ${left}1fr${toc}${right}`,
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

  /* Module-level slot for cross-component calls into the parent's
     selectPanel. KnowledgeGraph (a child of the editor area) registers
     nothing here — it reads via getSelectPanelForClicks() at click
     time. VaultView calls setSelectPanelForClicks(selectPanel) inside
     its setup so the registered fn is the SAME closure the template
     bound to the activity bar buttons. */
  if (!_selectPanelForClicks) {
    _selectPanelForClicks = selectPanel
  }

  function toggleAi() {
    aiOpen.value = !aiOpen.value
    // TOC visibility reacts to aiOpen via VaultView's tocVisible gate,
    // so we don't need to mutate any TOC state here. AI and TOC share
    // the right rail — when AI opens, the TOC track disappears from
    // the grid because the `!aiOpen` clause in vaultStyle elides it.
  }

  return {
    activePanel,
    sidePanelOpen,
    sidePanelWidth,
    editorRatio,
    aiOpen,
    aiPanelWidth,
    tocPanelWidth,
    vaultStyle,
    contentStyle,
    selectPanel,
    toggleAi,
  }
}
