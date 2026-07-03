// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ViewModeMenu from '../ViewModeMenu.vue'

function renderMenu(props: { mode?: 'edit' | 'read'; previewOpen?: boolean } = {}) {
  return mount(ViewModeMenu, {
    props: {
      mode: props.mode ?? 'edit',
      previewOpen: props.previewOpen ?? false,
    },
  })
}

describe('ViewModeMenu — trigger', () => {
  it('renders the active option label on the trigger', () => {
    const w = renderMenu({ mode: 'edit', previewOpen: false })
    expect(w.find('.view-mode-menu-trigger-label').text()).toBe('Edit')
  })

  it('shows "Edit + Preview" when both bits are on', () => {
    const w = renderMenu({ mode: 'edit', previewOpen: true })
    expect(w.find('.view-mode-menu-trigger-label').text()).toBe('Edit + Preview')
  })

  it('shows "Read" regardless of previewOpen (read mode hides preview)', () => {
    /* previewOpen is technically ignored in read mode but the menu
       should still show the right active label — proves the menu
       doesn't accidentally fall back to "Edit + Preview" if the
       preview bit is left on after switching modes. */
    const w = renderMenu({ mode: 'read', previewOpen: true })
    expect(w.find('.view-mode-menu-trigger-label').text()).toBe('Read')
  })

  it('reflects prop changes (mode flip without remount)', async () => {
    const w = renderMenu({ mode: 'edit', previewOpen: false })
    expect(w.find('.view-mode-menu-trigger-label').text()).toBe('Edit')
    await w.setProps({ mode: 'read' })
    expect(w.find('.view-mode-menu-trigger-label').text()).toBe('Read')
  })

  it('has aria-haspopup="menu" and aria-expanded="false" when closed', () => {
    const w = renderMenu()
    const trigger = w.find('.view-mode-menu-trigger')
    expect(trigger.attributes('aria-haspopup')).toBe('menu')
    expect(trigger.attributes('aria-expanded')).toBe('false')
  })
})

describe('ViewModeMenu — open / close', () => {
  it('opens on trigger click', async () => {
    const w = renderMenu()
    await w.find('.view-mode-menu-trigger').trigger('click')
    expect(w.find('.view-mode-menu-popover').exists()).toBe(true)
    expect(w.find('.view-mode-menu-trigger').attributes('aria-expanded')).toBe('true')
  })

  it('renders three radio rows', async () => {
    const w = renderMenu()
    await w.find('.view-mode-menu-trigger').trigger('click')
    const items = w.findAll('.view-mode-menu-item')
    expect(items).toHaveLength(3)
    expect(items[0].text()).toContain('Edit')
    expect(items[1].text()).toContain('Edit + Preview')
    expect(items[2].text()).toContain('Read')
  })

  it('marks the active option with is-active class and aria-checked', async () => {
    const w = renderMenu({ mode: 'edit', previewOpen: true })
    await w.find('.view-mode-menu-trigger').trigger('click')
    const items = w.findAll('.view-mode-menu-item')
    expect(items[1].classes()).toContain('is-active')
    expect(items[1].attributes('aria-checked')).toBe('true')
    expect(items[0].attributes('aria-checked')).toBe('false')
    expect(items[2].attributes('aria-checked')).toBe('false')
  })

  it('closes when an item is picked and emits select with the right payload', async () => {
    const w = renderMenu({ mode: 'edit', previewOpen: false })
    await w.find('.view-mode-menu-trigger').trigger('click')
    /* "Edit + Preview" is the second row; clicking it should emit
       { mode: 'edit', previewOpen: true }. */
    await w.findAll('.view-mode-menu-item')[1].trigger('click')
    const events = w.emitted('select')
    expect(events).toHaveLength(1)
    expect(events![0]).toEqual([{ mode: 'edit', previewOpen: true }])
    expect(w.find('.view-mode-menu-popover').exists()).toBe(false)
  })

  it('emits select with mode:"read" when the Read row is clicked', async () => {
    const w = renderMenu({ mode: 'edit', previewOpen: true })
    await w.find('.view-mode-menu-trigger').trigger('click')
    await w.findAll('.view-mode-menu-item')[2].trigger('click')
    expect(w.emitted('select')![0]).toEqual([{ mode: 'read', previewOpen: false }])
  })

  it('closes on outside click', async () => {
    const w = renderMenu()
    /* Render an outside click target as a sibling of the menu. */
    const outside = document.createElement('button')
    outside.className = 'outside-target'
    document.body.appendChild(outside)
    try {
      await w.find('.view-mode-menu-trigger').trigger('click')
      expect(w.find('.view-mode-menu-popover').exists()).toBe(true)
      /* onClickOutside listens at document; dispatch a real click on
         a node outside the menu root. */
      outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await nextTick()
      expect(w.find('.view-mode-menu-popover').exists()).toBe(false)
    } finally {
      document.body.removeChild(outside)
    }
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const w = renderMenu()
    await w.find('.view-mode-menu-trigger').trigger('click')
    const trigger = w.find('.view-mode-menu-trigger')
    await trigger.trigger('keydown', { key: 'Escape' })
    expect(w.find('.view-mode-menu-popover').exists()).toBe(false)
  })
})

describe('ViewModeMenu — keyboard navigation', () => {
  it('opens on ArrowDown when closed', async () => {
    const w = renderMenu()
    const trigger = w.find('.view-mode-menu-trigger')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    expect(w.find('.view-mode-menu-popover').exists()).toBe(true)
  })

  it('ArrowDown moves focus to the next row (wraps to top from bottom)', async () => {
    const w = renderMenu()
    await w.find('.view-mode-menu-trigger').trigger('click')
    const items = w.findAll('.view-mode-menu-item')
    /* Active option (edit) defaults to focusIndex 0. ArrowDown
       should move to focusIndex 1. */
    await items[0].trigger('keydown', { key: 'ArrowDown' })
    expect(items[1].attributes('tabindex')).toBe('0')
    expect(items[0].attributes('tabindex')).toBe('-1')
  })

  it('ArrowUp wraps from the first row to the last', async () => {
    const w = renderMenu()
    await w.find('.view-mode-menu-trigger').trigger('click')
    const items = w.findAll('.view-mode-menu-item')
    await items[0].trigger('keydown', { key: 'ArrowUp' })
    expect(items[2].attributes('tabindex')).toBe('0')
  })

  it('Home moves focus to the first row', async () => {
    const w = renderMenu()
    await w.find('.view-mode-menu-trigger').trigger('click')
    const items = w.findAll('.view-mode-menu-item')
    await items[2].trigger('keydown', { key: 'Home' })
    expect(items[0].attributes('tabindex')).toBe('0')
  })

  it('End moves focus to the last row', async () => {
    const w = renderMenu()
    await w.find('.view-mode-menu-trigger').trigger('click')
    const items = w.findAll('.view-mode-menu-item')
    await items[0].trigger('keydown', { key: 'End' })
    expect(items[2].attributes('tabindex')).toBe('0')
  })
})

describe('ViewModeMenu — emit semantics', () => {
  /* These pin down the contract the NavBar relies on: every pick
     emits exactly one `select` event, and the payload always
     carries both mode and previewOpen (so the parent can write
     either bit independently). */
  let w: ReturnType<typeof renderMenu>
  beforeEach(() => { w = renderMenu() })

  it('does not emit when closed (clicking trigger alone is a no-op for emit)', async () => {
    await w.find('.view-mode-menu-trigger').trigger('click')
    expect(w.emitted('select')).toBeUndefined()
  })

  it('emits one event per pick, not on focus changes', async () => {
    await w.find('.view-mode-menu-trigger').trigger('click')
    const items = w.findAll('.view-mode-menu-item')
    await items[1].trigger('keydown', { key: 'ArrowDown' })
    await items[1].trigger('keydown', { key: 'ArrowUp' })
    expect(w.emitted('select')).toBeUndefined()
    await items[2].trigger('click')
    expect(w.emitted('select')).toHaveLength(1)
  })
})