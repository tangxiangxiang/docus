// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { NNumberAnimation as NumberAnimation } from 'naive-ui'
import { describe, expect, it } from 'vitest'
import LedgerAnimatedMoney from '../LedgerAnimatedMoney.vue'

describe('LedgerAnimatedMoney', () => {
  it('starts core metric animations from zero without a delayed reset', () => {
    const wrapper = mount(LedgerAnimatedMoney, {
      props: { minor: 996_200, currency: 'CNY', animateOnMount: true },
    })
    const animation = wrapper.findComponent(NumberAnimation)

    expect(animation.props('from')).toBe(0)
    expect(animation.props('to')).toBe(9962)

    wrapper.unmount()
  })

  it('can keep record values static while preserving update animations elsewhere', async () => {
    const staticWrapper = mount(LedgerAnimatedMoney, {
      props: {
        minor: 120_000,
        currency: 'CNY',
        animateOnMount: false,
        animateOnChange: false,
      },
    })
    const staticAnimation = staticWrapper.findComponent(NumberAnimation)
    expect(staticAnimation.props('from')).toBe(1200)
    expect(staticAnimation.props('to')).toBe(1200)

    await staticWrapper.setProps({ minor: 130_000 })
    expect(staticWrapper.findComponent(NumberAnimation).props('from')).toBe(1300)
    expect(staticWrapper.findComponent(NumberAnimation).props('to')).toBe(1300)
    staticWrapper.unmount()

    const animatedWrapper = mount(LedgerAnimatedMoney, {
      props: { minor: 120_000, currency: 'CNY', animateOnMount: false },
    })
    await animatedWrapper.setProps({ minor: 130_000 })
    const animatedAnimation = animatedWrapper.findComponent(NumberAnimation)
    expect(animatedAnimation.props('from')).toBe(1200)
    expect(animatedAnimation.props('to')).toBe(1300)
    animatedWrapper.unmount()
  })
})
