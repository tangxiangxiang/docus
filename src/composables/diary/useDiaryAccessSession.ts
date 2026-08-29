import { computed, readonly, ref, watch, type Ref } from 'vue'
import {
  getDiaryAccessStatus,
  lockDiaryAccess,
  setupDiaryAccess,
  unlockDiaryAccess,
  type DiaryAccessState,
} from '../../lib/diary-access-api'
import { clearDiaryCapability, setDiaryCapability } from '../../lib/diary-capability'
import { subscribeDiaryAccessLocked } from '../../lib/auth-session'
import { useAuth } from '../useAuth'

export interface DiaryAccessSession {
  readonly state: Readonly<Ref<DiaryAccessState>>
  readonly epoch: Readonly<Ref<number | null>>
  readonly isUnlocked: Readonly<Ref<boolean>>
  readonly ensureStatus: () => Promise<DiaryAccessState>
  readonly setup: (password: string) => Promise<void>
  readonly unlock: (password: string) => Promise<void>
  readonly lock: () => Promise<void>
  readonly clear: () => void
}

const state = ref<DiaryAccessState>('UNINITIALIZED')
const epoch = ref<number | null>(null)
const isUnlocked = computed(() => state.value === 'UNLOCKED')
let generation = 0
let statusRequest: { generation: number; promise: Promise<DiaryAccessState> } | null = null
let authWatchWired = false
let expiryUnsubscribe: (() => void) | null = null
let serverLockUnsubscribe: (() => void) | null = null

function clear(): void {
  generation += 1
  statusRequest = null
  clearDiaryCapability()
  epoch.value = null
  if (state.value === 'UNLOCKED') state.value = 'LOCKED'
}

async function ensureStatus(): Promise<DiaryAccessState> {
  if (statusRequest?.generation === generation) return statusRequest.promise
  const requestGeneration = generation
  const pending = getDiaryAccessStatus()
    .then((status) => {
      if (requestGeneration !== generation) return state.value
      state.value = status.state
      epoch.value = status.epoch ?? null
      if (status.state !== 'UNLOCKED') clearDiaryCapability()
      return status.state
    })
    .finally(() => {
      if (statusRequest?.promise === pending) statusRequest = null
    })
  statusRequest = { generation: requestGeneration, promise: pending }
  return pending
}

async function setup(password: string): Promise<void> {
  const requestGeneration = ++generation
  statusRequest = null
  const result = await setupDiaryAccess(password)
  if (requestGeneration !== generation) return
  setDiaryCapability(result.capability)
  state.value = result.state
  epoch.value = result.epoch
}

async function unlock(password: string): Promise<void> {
  const requestGeneration = ++generation
  statusRequest = null
  const result = await unlockDiaryAccess(password)
  if (requestGeneration !== generation) return
  setDiaryCapability(result.capability)
  state.value = result.state
  epoch.value = result.epoch
}

async function lock(): Promise<void> {
  const requestGeneration = ++generation
  statusRequest = null
  clearDiaryCapability()
  epoch.value = null
  state.value = 'LOCKED'
  await lockDiaryAccess()
  if (requestGeneration !== generation) return
  state.value = 'LOCKED'
}

const coordinator: DiaryAccessSession = {
  state: readonly(state),
  epoch: readonly(epoch),
  isUnlocked: readonly(isUnlocked),
  ensureStatus,
  setup,
  unlock,
  lock,
  clear,
}

export function useDiaryAccessSession(): DiaryAccessSession {
  if (!authWatchWired) {
    const auth = useAuth()
    watch(auth.state, (next) => {
      if (next !== 'authenticated') clear()
    }, { immediate: true })
    expiryUnsubscribe = auth.onSessionExpired(clear)
    serverLockUnsubscribe = subscribeDiaryAccessLocked(clear)
    authWatchWired = true
  }
  void expiryUnsubscribe
  void serverLockUnsubscribe
  return coordinator
}

export function resetDiaryAccessSessionForTesting(): void {
  clearDiaryCapability()
  state.value = 'UNINITIALIZED'
  epoch.value = null
  generation += 1
  statusRequest = null
}
