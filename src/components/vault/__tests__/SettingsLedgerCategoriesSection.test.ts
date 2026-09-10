// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerAccountIcon, LedgerCategoryDto } from '../../../../shared/ledgerProtocol'
import SettingsLedgerCategoriesSection from '../SettingsLedgerCategoriesSection.vue'

const ledger = vi.hoisted(() => ({
  activeCategories: { value: [] as LedgerCategoryDto[] },
  categories: { value: [] as LedgerCategoryDto[] },
  bootstrap: vi.fn(),
  createCategory: vi.fn(),
  patchCategory: vi.fn(),
  archiveCategory: vi.fn(),
}))

vi.mock('../../../features/ledger/ledgerStore', () => ({
  useLedgerStore: () => ledger,
}))

const IconPickerStub = defineComponent({
  name: 'LedgerAccountIconPicker',
  props: { modelValue: { type: String, required: true }, disabled: Boolean },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('button', {
      class: 'icon-picker-stub',
      disabled: props.disabled,
      type: 'button',
      onClick: () => emit('update:modelValue', 'credit_card' satisfies LedgerAccountIcon),
    }, props.modelValue)
  },
})

function category(id: string, name: string, kind: 'income' | 'expense' = 'expense'): LedgerCategoryDto {
  return { id, kind, name, normalizedName: name, archivedAt: null, version: 3, createdAt: 1, updatedAt: 1 }
}

const wrappers: VueWrapper[] = []

function mountSection(): VueWrapper {
  const wrapper = mount(SettingsLedgerCategoriesSection, {
    attachTo: document.body,
    global: {
      stubs: {
        LedgerAccountIconPicker: IconPickerStub,
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  localStorage.clear()
  ledger.activeCategories.value = [category('food', '餐饮'), category('salary', '工资', 'income')]
  ledger.categories.value = ledger.activeCategories.value
  ledger.bootstrap.mockResolvedValue(undefined)
  ledger.patchCategory.mockResolvedValue(category('food', '通勤'))
  ledger.archiveCategory.mockResolvedValue({ ...category('food', '餐饮'), archivedAt: 2 })
  ledger.createCategory.mockResolvedValue(category('travel', '交通'))
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('SettingsLedgerCategoriesSection', () => {
  it('enters management after a 550ms hold and exits from the empty grid area', async () => {
    const wrapper = mountSection()
    const item = wrapper.get('.settings-ledger-category-option')

    await item.trigger('pointerdown')
    await vi.advanceTimersByTimeAsync(549)
    expect(item.classes()).not.toContain('managing')
    await vi.advanceTimersByTimeAsync(1)
    expect(item.classes()).toContain('managing')

    await wrapper.get('.settings-ledger-category-options').trigger('click')
    expect(item.classes()).not.toContain('managing')
  })

  it('renames and archives with the existing optimistic version', async () => {
    const wrapper = mountSection()
    const item = wrapper.get('[data-category-kind="expense"] .settings-ledger-category-option')
    await item.trigger('contextmenu')
    await item.get('.settings-ledger-category-label').trigger('dblclick')

    const input = item.get<HTMLInputElement>('.settings-ledger-category-name-input')
    expect(input.attributes('class')).not.toContain('n-input')
    await input.setValue('通勤')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(ledger.patchCategory).toHaveBeenCalledWith('food', { expectedVersion: 3, name: '通勤' })

    await item.get('[aria-label="归档分类：餐饮"]').trigger('click')
    await flushPromises()
    expect(ledger.archiveCategory).toHaveBeenCalledWith('food', 3)
  })

  it('does not start the hold gesture when the category icon is operated', async () => {
    const wrapper = mountSection()
    const item = wrapper.get('[data-category-kind="expense"] .settings-ledger-category-option')
    const picker = item.get('.icon-picker-stub')

    await picker.trigger('pointerdown')
    await vi.advanceTimersByTimeAsync(600)
    expect(item.classes()).not.toContain('managing')

    await picker.trigger('click')
    expect(ledger.patchCategory).toHaveBeenCalledWith('food', { expectedVersion: 3, icon: 'credit_card' })
  })

  it('creates an expense category directly from an uploaded SVG', async () => {
    const wrapper = mountSection()
    const expenseUpload = wrapper.find('input[type="file"]')
    Object.defineProperty(expenseUpload.element, 'files', { value: [new File(['<svg></svg>'], 'travel.svg', { type: 'image/svg+xml' })] })
    await expenseUpload.trigger('change')
    await flushPromises()

    expect(ledger.createCategory).toHaveBeenCalledWith({ kind: 'expense', name: 'travel', icon: expect.stringMatching(/^custom_/) })
  })

  it('reports a failed direct upload creation', async () => {
    ledger.createCategory.mockRejectedValueOnce(new Error('failed'))
    const wrapper = mountSection()
    const expenseUpload = wrapper.find('input[type="file"]')
    Object.defineProperty(expenseUpload.element, 'files', { value: [new File(['<svg></svg>'], 'failed.svg', { type: 'image/svg+xml' })] })
    await expenseUpload.trigger('change')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).not.toBe('')
  })
})
