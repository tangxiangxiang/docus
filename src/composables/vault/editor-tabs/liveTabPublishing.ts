import { shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import { resetTabPersistenceForTesting } from './useTabPersistence'

let liveTabs: ShallowRef<Tab[]> | null = null
let mirrorStop: (() => void) | null = null
let openPost: ((path: string) => void) | null = null

function teardownMirror() {
  mirrorStop?.()
  mirrorStop = null
}

export function getLiveTabs(): ShallowRef<Tab[]> | null {
  return liveTabs
}

export function __setLiveTabsForTesting(ref: ShallowRef<Tab[]> | null): void {
  teardownMirror()
  liveTabs = ref
}

export function __resetLiveTabsForTesting(): void {
  teardownMirror()
  liveTabs = null
  resetTabPersistenceForTesting()
}

export function publishLiveTabs(tabs: Ref<Tab[]>): void {
  teardownMirror()
  if (!liveTabs) liveTabs = shallowRef<Tab[]>(tabs.value)
  mirrorStop = watch(
    tabs,
    (value) => { if (liveTabs) liveTabs.value = value },
    { flush: 'post', deep: true },
  )
}

export function setOpenPostForClicks(fn: ((path: string) => void) | null): void {
  openPost = fn
}

export function getOpenPostForClicks(): ((path: string) => void) | null {
  return openPost
}

export function __resetOpenPostForClicks(fn: ((path: string) => void) | null): void {
  setOpenPostForClicks(fn)
}

export function clearOpenPostForClicks(fn: (path: string) => void): void {
  if (openPost === fn) setOpenPostForClicks(null)
}
