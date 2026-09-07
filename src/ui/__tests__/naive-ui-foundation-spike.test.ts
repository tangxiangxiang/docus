// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import NaiveUiFoundationSpike from './fixtures/NaiveUiFoundationSpike.vue'

type SpikeProps = {
  mode: 'light' | 'dark'
  locale: 'zh' | 'en'
}

const mountedWrappers: VueWrapper[] = []

function mountSpike(props: SpikeProps = { mode: 'light', locale: 'zh' }) {
  const wrapper = mount(NaiveUiFoundationSpike, {
    attachTo: document.body,
    props,
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('Naive UI icon foundation spike', () => {
  it('mounts Naive primitives and a Tabler icon through NIcon', () => {
    const wrapper = mountSpike()

    expect(wrapper.get('[data-testid="spike-button"]')).toBeTruthy()
    expect(wrapper.get('[data-testid="spike-input"] input')).toBeTruthy()
    expect(wrapper.get('[data-testid="spike-select"]')).toBeTruthy()
    expect(wrapper.get('[data-testid="spike-date-picker"] input')).toBeTruthy()
    expect(wrapper.get('[data-testid="spike-standalone-icon"] svg').attributes('viewBox')).toBe('0 0 24 24')

    const icon = wrapper.get('[data-testid="spike-button"] svg')
    expect(icon.attributes('viewBox')).toBe('0 0 24 24')
    expect(wrapper.get('[data-testid="spike-button"] .n-icon').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('[data-testid="spike-button"] svg g').attributes('stroke')).toBe('currentColor')
    expect(wrapper.get('[data-testid="spike-button"] svg g').attributes('stroke-width')).toBe('2')

    const searchButton = wrapper.get('[data-testid="spike-icon-only-button"]')
    expect(searchButton.attributes('aria-label')).toBe('Search notes')
    expect(searchButton.get('.n-icon').attributes('aria-hidden')).toBe('true')
  })

  it('accepts CSS custom properties in theme overrides and switches light/dark at runtime', async () => {
    const wrapper = mountSpike()
    const lightHtml = wrapper.html()
    const lightButtonStyle = wrapper.get('[data-testid="spike-button"]').attributes('style')
    const surface = wrapper.get('[data-testid="spike-surface"]').element

    expect(lightHtml).toContain('var(--docus-spike-border)')

    await wrapper.setProps({ mode: 'dark' })
    await nextTick()
    const darkHtml = wrapper.html()

    expect(darkHtml).toContain('var(--docus-spike-border)')
    expect(wrapper.get('[data-testid="spike-button"]').attributes('style')).not.toBe(lightButtonStyle)
    expect(wrapper.get('[data-testid="spike-config-provider"]').element).toBeTruthy()

    await wrapper.setProps({ mode: 'light' })
    await nextTick()
    expect(wrapper.get('[data-testid="spike-button"]').attributes('style')).toBe(lightButtonStyle)
    expect(wrapper.get('[data-testid="spike-surface"]').element).toBe(surface)
  })

  it('keeps Naive locale and date locale synchronized without remounting the surface', async () => {
    const wrapper = mountSpike({ mode: 'light', locale: 'zh' })
    const surface = wrapper.get('[data-testid="spike-surface"]').element
    const chinesePlaceholder = wrapper.get('[data-testid="spike-date-picker"] input').attributes('placeholder')

    expect(chinesePlaceholder).toContain('日期')

    await wrapper.setProps({ locale: 'en' })
    await nextTick()
    expect(wrapper.get('[data-testid="spike-date-picker"] input').attributes('placeholder')).toBe('Select Date')
    expect(wrapper.get('[data-testid="spike-surface"]').element).toBe(surface)

    await wrapper.setProps({ locale: 'zh' })
    await nextTick()
    expect(wrapper.get('[data-testid="spike-date-picker"] input').attributes('placeholder')).toBe(chinesePlaceholder)
  })

  it('exposes dialog, message, notification, and Teleport providers', async () => {
    const wrapper = mountSpike()

    await wrapper.get('[data-testid="spike-open-dialog"]').trigger('click')
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    await wrapper.get('[data-testid="spike-show-message"]').trigger('click')
    expect(document.body.querySelector('.n-message-container')).not.toBeNull()

    await wrapper.get('[data-testid="spike-show-notification"]').trigger('click')
    expect(document.body.querySelector('.n-notification-container')).not.toBeNull()
  })

  it('renders the NIcon foundation through Vue SSR', async () => {
    const html = await renderToString(h(NaiveUiFoundationSpike, {
      mode: 'light',
      locale: 'en',
    }))

    expect(html).toContain('n-config-provider')
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain('Create note')
  })
})
