// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ConfirmHost from '../ConfirmHost.vue'
import { useConfirm } from '../../composables/useConfirm'
import { useI18n } from '../../composables/useI18n'

afterEach(() => {
  useI18n().setLocale('zh')
  document.body.innerHTML = ''
})

describe('ConfirmHost', () => {
  it('renders custom destructive labels and resolves from the explicit action', async () => {
    const wrapper = mount(ConfirmHost)
    const request = useConfirm().confirm('Restore historical version?', 'Stable details', {
      cancelLabel: 'Cancel',
      confirmLabel: 'Restore Version',
      destructive: true,
    })
    await flushPromises()

    const dialog = document.querySelector('[role="alertdialog"]')!
    expect(dialog.getAttribute('aria-label')).toBe('Restore historical version?')
    expect(dialog.textContent).toContain('Stable details')
    const destructive = dialog.querySelector<HTMLButtonElement>('.btn-danger')!
    expect(destructive.textContent).toContain('Restore Version')
    destructive.click()

    await expect(request).resolves.toBe(true)
    wrapper.unmount()
  })

  it('supports Escape cancellation and restores focus to the trigger', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const wrapper = mount(ConfirmHost)
    const request = useConfirm().confirm('Restore historical version?')
    await flushPromises()

    const cancel = document.querySelector<HTMLButtonElement>('.confirm-actions .btn')!
    expect(document.activeElement).toBe(cancel)

    const host = document.querySelector<HTMLElement>('.confirm-host')!
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect(request).resolves.toBe(false)
    await flushPromises()

    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })
})
