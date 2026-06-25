// @vitest-environment jsdom
// Tests for useVaultLayout.
//
// The composable's only truly load-bearing logic is the localStorage
// schema migration: existing users on an older build have a payload
// shaped {fileTreeOpen, fileTreeWidth} and the new code must read those
// values, translate them into the new {activePanel, sidePanelWidth,
// editorRatio} shape, and from then on write the new shape only. A
// regression here would silently drop every existing user's panel
// preference — so it gets a regression-pinned test.
//
// The persistence + bidirectional-watch wiring is also covered with a
// few smoke tests so that future refactors of the useStorage plumbing
// don't accidentally break the writer.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
  useVaultLayout,
  setSelectPanelForClicks,
  getSelectPanelForClicks,
  __resetSelectPanelForClicks,
  __resetVaultLayoutState,
  type VaultLayout,
} from '../useVaultLayout'

const STORAGE_KEY = 'docus.vault.layout'

interface Harness {
  activePanel: Ref<string | null>
  sidePanelOpen: Ref<boolean>
  sidePanelWidth: Ref<number>
  editorRatio: Ref<number>
  aiOpen: Ref<boolean>
  aiPanelWidth: Ref<number>
  tocPanelWidth: Ref<number>
  selectPanel: (p: 'files' | 'tags' | 'graph') => void
  toggleAi: () => void
  vaultStyle: { value: { gridTemplateColumns: string } }
}

function setup(opts: { tocGate?: () => boolean } = {}): Harness {
  let captured: Harness | null = null
  const Comp = defineComponent({
    setup() {
      const layout = useVaultLayout(opts)
      captured = {
        activePanel: layout.activePanel as Ref<string | null>,
        sidePanelOpen: layout.sidePanelOpen as Ref<boolean>,
        sidePanelWidth: layout.sidePanelWidth,
        editorRatio: layout.editorRatio,
        aiOpen: layout.aiOpen,
        aiPanelWidth: layout.aiPanelWidth,
        tocPanelWidth: layout.tocPanelWidth,
        selectPanel: layout.selectPanel,
        toggleAi: layout.toggleAi,
        vaultStyle: layout.vaultStyle as Harness['vaultStyle'],
      }
      return () => h('div')
    },
  })
  mount(Comp)
  return captured!
}

describe('useVaultLayout', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetSelectPanelForClicks()
    __resetVaultLayoutState()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('starts with defaults when localStorage is empty', () => {
    const h = setup()
    expect(h.activePanel.value).toBe('files')
    expect(h.sidePanelWidth.value).toBe(260)
    expect(h.editorRatio.value).toBe(1)
  })

  it('exposes aiOpen=false and aiPanelWidth=320 by default', () => {
    const h = setup()
    expect(h.aiOpen.value).toBe(false)
    expect(h.aiPanelWidth.value).toBe(320)
  })

  it('exposes tocPanelWidth=320 by default (matching the AI panel width)', () => {
    // The TOC panel's *visibility* is no longer a persisted ref — it's
    // derived from view-mode + headings + AI panel state in VaultView.
    // Only the user's preferred width is persisted.
    const h = setup()
    expect(h.tocPanelWidth.value).toBe(320)
  })

  it('migrates the old fileTreeOpen/fileTreeWidth shape into the new shape', () => {
    // The pre-vault shape that existing users have on disk.
    const oldShape = { fileTreeOpen: true, fileTreeWidth: 312 }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldShape))
    const h = setup()
    // fileTreeOpen=true → activePanel='files'
    expect(h.activePanel.value).toBe('files')
    // fileTreeWidth=312 → sidePanelWidth=312
    expect(h.sidePanelWidth.value).toBe(312)
    // editorRatio is new and gets the default
    expect(h.editorRatio.value).toBe(1)
  })

  it('migrates fileTreeOpen=false to activePanel=null', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fileTreeOpen: false, fileTreeWidth: 200 }))
    const h = setup()
    expect(h.activePanel.value).toBeNull()
    expect(h.sidePanelWidth.value).toBe(200)
  })

  it('prefers the new shape when both old and new keys are present', () => {
    // Mixed payload — the new shape should win because it was written
    // most recently by an in-between build.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fileTreeOpen: true,
      fileTreeWidth: 200,
      activePanel: 'tags',
      sidePanelWidth: 400,
      editorRatio: 0.5,
    }))
    const h = setup()
    expect(h.activePanel.value).toBe('tags')
    expect(h.sidePanelWidth.value).toBe(400)
    expect(h.editorRatio.value).toBe(0.5)
  })

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    const h = setup()
    expect(h.activePanel.value).toBe('files')
    expect(h.sidePanelWidth.value).toBe(260)
    expect(h.editorRatio.value).toBe(1)
  })

  it('ignores an unknown activePanel value (treats it as null)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activePanel: 'settings' }))
    const h = setup()
    expect(h.activePanel.value).toBeNull()
  })

  it('selectPanel toggles the active panel off when called with the same panel', () => {
    const h = setup()
    expect(h.activePanel.value).toBe('files')
    h.selectPanel('files')
    expect(h.activePanel.value).toBeNull()
    h.selectPanel('files')
    expect(h.activePanel.value).toBe('files')
  })

  it('selectPanel switches to a different panel in one call', () => {
    const h = setup()
    h.selectPanel('tags')
    expect(h.activePanel.value).toBe('tags')
  })

  it('toggleAi flips aiOpen off and on', () => {
    const h = setup()
    expect(h.aiOpen.value).toBe(false)
    h.toggleAi()
    expect(h.aiOpen.value).toBe(true)
    h.toggleAi()
    expect(h.aiOpen.value).toBe(false)
  })

  it('vaultStyle uses 4 columns when side=off, ai=off, tocGate=true (default)', () => {
    const h = setup()
    h.selectPanel('files') // close the default-open side panel
    // aiOpen defaults to false; tocGate defaults to ref(true) in the
    // harness so the TOC track is emitted.
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 1fr 1px 320px')
  })

  it('vaultStyle adds the side panel columns when active', () => {
    const h = setup()
    // default state: side='files', aiOpen=false, tocGate=true.
    // Side and TOC coexist on opposite rails — combined ~580px
    // leaves plenty of room for the editor area. VaultView passes
    // tocPanelEnabled (read mode + has headings) as the gate in
    // production, so the track only appears when the panel renders.
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr 1px 320px')
  })

  it('vaultStyle elides the TOC track when the external gate is false', () => {
    // Regression: edit mode means tocGate=false, and the TOC panel
    // would be v-if'd off. Without the gate plumbing, vaultStyle
    // would emit a 320px column even when <TocPanel> doesn't render,
    // leaving a gray strip on the right.
    const h = setup({ tocGate: () => false })
    // default: side='files', aiOpen=false, gate=false → no toc track
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr')
  })

  it('vaultStyle reactively follows the gate after construction', async () => {
    // Mirrors the production transition: user opens the app in edit
    // mode (gate=false), then switches to read mode with headings
    // (gate=true). The TOC track must appear without remount.
    const gate = ref(false)
    let layout: ReturnType<typeof useVaultLayout> | null = null
    const Comp = defineComponent({
      setup() {
        layout = useVaultLayout({ tocGate: () => gate.value })
        return () => h('div')
      },
    })
    mount(Comp)
    // initial: gate=false → no toc track
    expect(layout!.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr')
    // gate flips true → next read of vaultStyle must recompute
    gate.value = true
    await Promise.resolve()
    expect(layout!.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr 1px 320px')
    // gate flips false again → toc track gone
    gate.value = false
    await Promise.resolve()
    expect(layout!.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr')
  })

  it('vaultStyle emits the TOC track when side panel is closed', () => {
    const h = setup()
    h.selectPanel('files') // close side
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 1fr 1px 320px')
  })

  it('vaultStyle coexists side panel and TOC track (side=on, gate=true, ai=off)', () => {
    const h = setup()
    // default: side='files', aiOpen=false, gate=true
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr 1px 320px')
  })

  it('vaultStyle suppresses the TOC track when AI panel opens', () => {
    // AI panel and TOC share the right rail — only one may be open.
    // vaultStyle's `!aiOpen` clause elides the toc track when AI opens.
    const h = setup()
    h.selectPanel('files') // close side so toc would otherwise be visible
    h.toggleAi()           // open AI
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 1fr 1px 320px')
  })

  it('vaultStyle adds the AI columns when aiOpen=true', () => {
    const h = setup()
    h.selectPanel('files') // close side
    h.toggleAi() // open AI
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 1fr 1px 320px')
  })

  it('vaultStyle shows all 5 columns when side panel and AI are both open', () => {
    const h = setup()
    h.toggleAi() // open AI (side is already 'files' by default)
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr 1px 320px')
  })

  it('persists changes back to localStorage in the new shape only', async () => {
    const h = setup()
    h.selectPanel('tags')
    // The watcher is sync; one microtask tick is enough.
    await Promise.resolve()
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as VaultLayout
    // New shape — no fileTreeOpen / fileTreeWidth.
    expect(parsed).not.toHaveProperty('fileTreeOpen')
    expect(parsed).not.toHaveProperty('fileTreeWidth')
    expect(parsed.activePanel).toBe('tags')
    expect(typeof parsed.sidePanelWidth).toBe('number')
    expect(typeof parsed.editorRatio).toBe('number')
  })

  it('persists aiOpen and aiPanelWidth when toggled', async () => {
    // Closes the gap left by the "persists changes back" test above,
    // which only checks sidePanelWidth/editorRatio. Without this, a
    // refactor that drops the new fields from the writer would pass.
    const h = setup()
    h.toggleAi()
    await Promise.resolve()
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as VaultLayout
    expect(parsed.aiOpen).toBe(true)
    expect(parsed.aiPanelWidth).toBe(320)
  })

  it('falls back to aiOpen=false and aiPanelWidth=320 when hydrating the old shape', () => {
    // Old-shape payload (no aiOpen / aiPanelWidth). The serializer must
    // default them; otherwise the new fields surface as undefined and
    // the grid layout silently breaks for users upgrading.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fileTreeOpen: true, fileTreeWidth: 280 }))
    const h = setup()
    expect(h.aiOpen.value).toBe(false)
    expect(h.aiPanelWidth.value).toBe(320)
  })

  it('sidePanelOpen is true for files/tags/links and false for graph and null', () => {
    const h = setup()
    // default: 'files' is a side panel
    expect(h.sidePanelOpen.value).toBe(true)
    h.selectPanel('tags')
    expect(h.sidePanelOpen.value).toBe(true)
    h.selectPanel('graph')
    // graph is a body mode, not a side panel
    expect(h.sidePanelOpen.value).toBe(false)
    h.selectPanel('graph') // toggle off -> null
    expect(h.activePanel.value).toBeNull()
    expect(h.sidePanelOpen.value).toBe(false)
  })

  it('vaultStyle emits 4 columns when activePanel is graph (no side panel, TOC on)', () => {
    // Regression: the graph panel is rendered inside .editor-area, not
    // next to the activity bar. If the side-panel track were emitted
    // for graph mode, .editor-area would shrink to 1px and the
    // force-graph canvas would have nowhere to render. The TOC track
    // is on the right of editor-area, so the graph canvas inside the
    // 1fr column still has the full width to itself.
    const h = setup()
    h.selectPanel('graph')
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 1fr 1px 320px')
  })

  it('publishes selectPanel via the cross-component slot, callable from any consumer', () => {
    // The KnowledgeGraph child component lives in the editor area and
    // cannot import VaultView's layout instance. It calls the
    // registered selectPanel to close the graph panel on node click.
    // We verify the slot is writable, readable, and clearable, which
    // is the contract KnowledgeGraph relies on.
    expect(getSelectPanelForClicks()).toBeNull()
    const captured: string[] = []
    /* The slot's signature is `SidePanel` (4 values: files/tags/graph/history)
       so test consumers must accept the full union. Narrowing it here
       would be a lie about the API surface KnowledgeGraph relies on. */
    const fn = (p: 'files' | 'tags' | 'graph' | 'history') => { captured.push(p) }
    setSelectPanelForClicks(fn)
    expect(getSelectPanelForClicks()).toBe(fn)
    // The "child" can call it — it runs, even if it has no effect
    // on a state the parent doesn't own.
    getSelectPanelForClicks()!('files')
    expect(captured).toEqual(['files'])
    // Reset is honored — the next reader gets null and won't crash.
    __resetSelectPanelForClicks()
    expect(getSelectPanelForClicks()).toBeNull()
  })
})
