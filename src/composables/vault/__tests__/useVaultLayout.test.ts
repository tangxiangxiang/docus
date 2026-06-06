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
import { defineComponent, h, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useVaultLayout, type VaultLayout } from '../useVaultLayout'

const STORAGE_KEY = 'docus.vault.layout'

interface Harness {
  activePanel: Ref<string | null>
  sidePanelWidth: Ref<number>
  editorRatio: Ref<number>
  aiOpen: Ref<boolean>
  aiPanelWidth: Ref<number>
  selectPanel: (p: 'files' | 'tags') => void
  toggleAi: () => void
  vaultStyle: { value: { gridTemplateColumns: string } }
}

function setup(): Harness {
  let captured: Harness | null = null
  const Comp = defineComponent({
    setup() {
      const layout = useVaultLayout()
      captured = {
        activePanel: layout.activePanel as Ref<string | null>,
        sidePanelWidth: layout.sidePanelWidth,
        editorRatio: layout.editorRatio,
        aiOpen: layout.aiOpen,
        aiPanelWidth: layout.aiPanelWidth,
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

  it('vaultStyle uses 2 columns when both side and AI panels are closed', () => {
    const h = setup()
    h.selectPanel('files') // close the default-open side panel
    // aiOpen defaults to false, so no toggle needed
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 1fr')
  })

  it('vaultStyle adds the side panel columns when active', () => {
    const h = setup()
    // default state: side='files', aiOpen=false → 4 columns
    expect(h.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr')
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
})
