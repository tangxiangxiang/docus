// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { __resetVaultLayoutState, useVaultLayout } from '../useVaultLayout'

const STORAGE_KEY = 'docus.vault.layout'

function setup() {
  let layout!: ReturnType<typeof useVaultLayout>
  const wrapper = mount(defineComponent({
    setup() {
      layout = useVaultLayout()
      return () => h('div')
    },
  }))
  return { layout, wrapper }
}

describe('useVaultLayout', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetVaultLayoutState()
  })

  afterEach(() => localStorage.clear())

  it('starts with one visible 360px right rail on the TOC tab', () => {
    const { layout } = setup()
    expect(layout.rightRailTab.value).toBe('toc')
    expect(layout.rightRailWidth.value).toBe(360)
    expect(layout.rightRailCollapsed.value).toBe(false)
    expect(layout.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr 1px 360px')
  })

  it('migrates legacy file tree and TOC width fields', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fileTreeOpen: false,
      fileTreeWidth: 312,
      tocPanelWidth: 404,
    }))
    const { layout } = setup()
    expect(layout.activePanel.value).toBeNull()
    expect(layout.sidePanelWidth.value).toBe(312)
    expect(layout.rightRailWidth.value).toBe(404)
    expect(layout.rightRailTab.value).toBe('toc')
  })

  it('migrates an open legacy AI panel to the AI tab', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      activePanel: 'files',
      aiOpen: true,
      aiPanelWidth: 470,
      rightRailCollapsed: true,
    }))
    const { layout } = setup()
    expect(layout.rightRailTab.value).toBe('ai')
    expect(layout.rightRailWidth.value).toBe(470)
    expect(layout.rightRailCollapsed.value).toBe(false)
  })

  it('clamps migrated right rail width to the supported range', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rightRailWidth: 999 }))
    expect(setup().layout.rightRailWidth.value).toBe(520)
  })

  it('AI toggle opens, switches, and collapses the unified rail', () => {
    const { layout } = setup()
    layout.rightRailCollapsed.value = true
    layout.toggleAi()
    expect(layout.rightRailCollapsed.value).toBe(false)
    expect(layout.rightRailTab.value).toBe('ai')

    layout.rightRailTab.value = 'links'
    layout.toggleAi()
    expect(layout.rightRailTab.value).toBe('ai')
    expect(layout.rightRailCollapsed.value).toBe(false)

    layout.toggleAi()
    expect(layout.rightRailCollapsed.value).toBe(true)
  })

  it('removes the right rail tracks when collapsed', () => {
    const { layout } = setup()
    layout.rightRailCollapsed.value = true
    expect(layout.vaultStyle.value.gridTemplateColumns).toBe('48px 260px 1px 1fr')
  })

  it('persists only the unified right rail fields', async () => {
    const { layout } = setup()
    layout.rightRailTab.value = 'links'
    layout.rightRailWidth.value = 420
    await nextTick()
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.rightRailTab).toBe('links')
    expect(stored.rightRailWidth).toBe(420)
    expect(stored).not.toHaveProperty('aiOpen')
    expect(stored).not.toHaveProperty('aiPanelWidth')
    expect(stored).not.toHaveProperty('tocPanelWidth')
  })

  it('hides the retired persistent recovery panel while retaining old layouts', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activePanel: 'recovery' }))
    const { layout } = setup()
    expect(layout.activePanel.value).toBeNull()
    expect(layout.sidePanelOpen.value).toBe(false)
  })

  it('shares the selected tab across consumers', () => {
    const first = setup().layout
    const second = setup().layout
    first.rightRailTab.value = 'ai'
    expect(second.rightRailTab.value).toBe('ai')
  })

  it('drops unknown fields from persisted layout (forward-compat with old previewOpen)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      rightRailTab: 'toc',
      rightRailWidth: 360,
      rightRailCollapsed: false,
      previewOpen: true, // legacy field from before Preview was removed
    }))
    __resetVaultLayoutState()
    const { layout } = setup()
    // No crash; the legacy field is simply ignored.
    expect(layout.rightRailTab.value).toBe('toc')
    expect(layout.rightRailWidth.value).toBe(360)
    // And it never re-emerges when the layout is rewritten. The
    // persistence watcher only fires on real mutations, so toggle a tab
    // and await a tick to flush the rewrite.
    layout.rightRailTab.value = 'ai'
    await nextTick()
    expect(localStorage.getItem(STORAGE_KEY)!).not.toContain('previewOpen')
  })
})
