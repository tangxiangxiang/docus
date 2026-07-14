// @vitest-environment jsdom

import { computed, defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../components/vault/tabs'
import { createVaultContext } from '../createVaultContext'
import { provideVaultContext, useVaultContext } from '../useVaultContext'
import { createVaultFileChanges } from '../fileChanges'
import { useAiHistory } from '../../useAiHistory'

function tab(path: string, raw: string): Tab {
  return {
    path,
    title: path,
    raw,
    originalRaw: raw,
    revision: 0,
    savedRevision: 0,
    savingRevision: null,
    saveStatus: 'idle',
    error: null,
    loadError: null,
    loading: false,
    serverMtime: 0,
    externalRaw: null,
  }
}

describe('Vault context', () => {
  it('keeps independently created workspace state and navigation isolated', async () => {
    const tabsA = ref([tab('a', 'A')])
    const tabsB = ref([tab('b', 'B')])
    const activeA = ref<string | null>('a')
    const activeB = ref<string | null>('b')
    const openedA: string[] = []
    const openedB: string[] = []
    const contextA = createVaultContext({
      vaultId: ref('vault-a'),
      fileChanges: createVaultFileChanges(),
      tabs: tabsA,
      activePath: activeA,
      activeTab: computed(() => tabsA.value.find((item) => item.path === activeA.value) ?? null),
      openPost: async (path) => { openedA.push(path) },
    })
    const contextB = createVaultContext({
      vaultId: ref('vault-b'),
      fileChanges: createVaultFileChanges(),
      tabs: tabsB,
      activePath: activeB,
      activeTab: computed(() => tabsB.value.find((item) => item.path === activeB.value) ?? null),
      openPost: async (path) => { openedB.push(path) },
    })

    tabsA.value[0].raw = 'A edited'
    activeA.value = null
    await contextA.editor.openPost('next-a')
    contextA.fileChanges.publish({ path: 'a', kind: 'write', newRaw: 'A from AI' })
    contextA.toc.tocActiveId.value = 'heading-a'

    expect(contextA.editor.getLiveContent('a')).toBe('A edited')
    expect(contextB.editor.getLiveContent('b')).toBe('B')
    expect(contextB.editor.activePath.value).toBe('b')
    expect(contextA.vaultId.value).toBe('vault-a')
    expect(contextB.vaultId.value).toBe('vault-b')
    expect(openedA).toEqual(['next-a'])
    expect(openedB).toEqual([])
    expect(contextA.fileChanges.events.value).toHaveLength(1)
    expect(contextB.fileChanges.events.value).toEqual([])
    expect(contextA.toc.tocActiveId.value).toBe('heading-a')
    expect(contextB.toc.tocActiveId.value).toBe('')
  })

  it('disposes one vault without affecting another', () => {
    const makeContext = (id: string) => createVaultContext({
      vaultId: ref(id),
      fileChanges: createVaultFileChanges(),
      tabs: ref<Tab[]>([]),
      activePath: ref(null),
      activeTab: computed(() => null),
      openPost: async () => {},
    })
    const contextA = makeContext('vault-a')
    const contextB = makeContext('vault-b')
    let disposedA = 0
    let disposedB = 0
    contextA.onDispose(() => { disposedA += 1 })
    contextB.onDispose(() => { disposedB += 1 })

    contextA.dispose()

    expect(disposedA).toBe(1)
    expect(disposedB).toBe(0)
    contextB.dispose()
    expect(disposedB).toBe(1)
  })

  it('provides the same typed context to descendants', () => {
    const tabs = ref([tab('a', 'A')])
    const context = createVaultContext({
      vaultId: ref('vault-a'),
      fileChanges: createVaultFileChanges(),
      tabs,
      activePath: ref('a'),
      activeTab: computed(() => tabs.value[0]),
      openPost: async () => {},
    })
    let injected: ReturnType<typeof useVaultContext> | null = null
    const Child = defineComponent({
      setup() {
        injected = useVaultContext()
        return () => h('div')
      },
    })
    const Parent = defineComponent({
      setup() {
        provideVaultContext(context)
        return () => h(Child)
      },
    })

    mount(Parent)
    expect(injected).toBe(context)
  })

  it('keeps AI history isolated between vault providers', () => {
    const makeContext = (id: string) => {
      const tabs = ref<Tab[]>([])
      return createVaultContext({
        vaultId: ref(id),
        fileChanges: createVaultFileChanges(),
        tabs,
        activePath: ref(null),
        activeTab: computed(() => null),
        openPost: async () => {},
      })
    }
    const contextA = makeContext('vault-a')
    const contextB = makeContext('vault-b')
    let historyA: ReturnType<typeof useAiHistory> | null = null
    let historyB: ReturnType<typeof useAiHistory> | null = null
    const Child = defineComponent({
      props: { target: { type: String, required: true } },
      setup(props) {
        const history = useAiHistory()
        if (props.target === 'a') historyA = history
        else historyB = history
        return () => h('div')
      },
    })
    const Provider = defineComponent({
      props: { context: { type: Object, required: true }, target: { type: String, required: true } },
      setup(props) {
        provideVaultContext(props.context as ReturnType<typeof makeContext>)
        return () => h(Child, { target: props.target })
      },
    })

    mount(defineComponent({
      setup: () => () => h('div', [
        h(Provider, { context: contextA, target: 'a' }),
        h(Provider, { context: contextB, target: 'b' }),
      ]),
    }))

    historyA!.configured.value = true
    expect(historyA).not.toBe(historyB)
    expect(historyB!.configured.value).toBe(false)
  })

  it('fails clearly outside a Vault provider', () => {
    const Child = defineComponent({
      setup() {
        useVaultContext()
        return () => h('div')
      },
    })
    expect(() => mount(Child)).toThrow('Vault context is not available')
  })
})
