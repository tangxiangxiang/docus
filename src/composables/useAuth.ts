import { computed, readonly, ref, type Ref } from 'vue'
import {
  getAuthStatus,
  login as loginApi,
  setupOwner as setupOwnerApi,
  type AuthApiError,
  type AuthStatusResponse,
  type AuthUser,
  type LoginRequest,
  type SetupRequest,
} from '../lib/auth-api'
import {
  advanceAuthSessionGeneration,
  captureAuthSessionGeneration,
  subscribeAuthSessionRequired,
  type AuthSessionRequiredEvent,
} from '../lib/auth-session'

export type AuthState = 'unknown' | 'setup-required' | 'unauthenticated' | 'authenticated'

type SessionExpiredListener = () => void

const state = ref<AuthState>('unknown')
const user = ref<AuthUser | null>(null)
const hydrating = ref(false)
const submitting = ref(false)
const hydrationError = ref<unknown>(null)
const sessionExpired = ref(false)

let generation = captureAuthSessionGeneration()
let hydrationPromise: Promise<AuthState> | null = null
const expiryListeners = new Set<SessionExpiredListener>()

function applyStatus(status: AuthStatusResponse): void {
  if (status.authenticated) {
    state.value = 'authenticated'
    user.value = status.user ?? null
  } else if (status.setupRequired) {
    state.value = 'setup-required'
    user.value = null
  } else {
    state.value = 'unauthenticated'
    user.value = null
  }
}

function beginTransition(): number {
  generation = advanceAuthSessionGeneration()
  hydrationPromise = null
  hydrating.value = false
  hydrationError.value = null
  return generation
}

async function ensureHydrated(): Promise<AuthState> {
  if (state.value !== 'unknown') return state.value
  if (hydrationPromise) return hydrationPromise

  const requestGeneration = generation
  hydrating.value = true
  hydrationError.value = null
  const pending = getAuthStatus()
    .then((status) => {
      if (requestGeneration === generation) applyStatus(status)
      return state.value
    })
    .catch((error: unknown) => {
      if (requestGeneration === generation) {
        state.value = 'unknown'
        user.value = null
        hydrationError.value = error
      }
      return state.value
    })
    .finally(() => {
      if (requestGeneration === generation) {
        hydrating.value = false
        hydrationPromise = null
      }
    })
  hydrationPromise = pending
  return pending
}

async function refreshStatus(): Promise<AuthState> {
  beginTransition()
  state.value = 'unknown'
  user.value = null
  return ensureHydrated()
}

async function setup(input: SetupRequest): Promise<AuthUser> {
  const transitionGeneration = beginTransition()
  submitting.value = true
  try {
    const result = await setupOwnerApi(input)
    if (transitionGeneration === generation) {
      state.value = 'authenticated'
      user.value = result.user
      sessionExpired.value = false
    }
    return result.user
  } finally {
    if (transitionGeneration === generation) submitting.value = false
  }
}

async function login(input: LoginRequest): Promise<AuthUser> {
  const transitionGeneration = beginTransition()
  submitting.value = true
  try {
    const result = await loginApi(input)
    if (transitionGeneration === generation) {
      state.value = 'authenticated'
      user.value = result.user
      sessionExpired.value = false
    }
    return result.user
  } finally {
    if (transitionGeneration === generation) submitting.value = false
  }
}

function onSessionRequired(event: AuthSessionRequiredEvent): void {
  // A response that began before a successful setup/login must not invalidate
  // the newly authenticated state when its body is observed later.
  if (event.generation !== generation || state.value !== 'authenticated') return
  generation = advanceAuthSessionGeneration()
  hydrationPromise = null
  state.value = 'unauthenticated'
  user.value = null
  sessionExpired.value = true
  for (const listener of [...expiryListeners]) listener()
}

subscribeAuthSessionRequired(onSessionRequired)

export interface AuthCoordinator {
  readonly state: Readonly<Ref<AuthState>>
  readonly user: Readonly<Ref<AuthUser | null>>
  readonly hydrating: Readonly<Ref<boolean>>
  readonly submitting: Readonly<Ref<boolean>>
  readonly hydrationError: Readonly<Ref<unknown>>
  readonly sessionExpired: Readonly<Ref<boolean>>
  ensureHydrated: () => Promise<AuthState>
  refreshStatus: () => Promise<AuthState>
  setup: (input: SetupRequest) => Promise<AuthUser>
  login: (input: LoginRequest) => Promise<AuthUser>
  onSessionExpired: (listener: SessionExpiredListener) => () => void
  resetAuthForTesting: () => void
}

function onSessionExpired(listener: SessionExpiredListener): () => void {
  expiryListeners.add(listener)
  return () => expiryListeners.delete(listener)
}

export function resetAuthForTesting(): void {
  generation = advanceAuthSessionGeneration()
  hydrationPromise = null
  state.value = 'unknown'
  user.value = null
  hydrating.value = false
  submitting.value = false
  hydrationError.value = null
  sessionExpired.value = false
}

const coordinator: AuthCoordinator = {
  state: readonly(state),
  user: readonly(user),
  hydrating: readonly(hydrating),
  submitting: readonly(submitting),
  hydrationError: readonly(hydrationError),
  sessionExpired: readonly(sessionExpired),
  ensureHydrated,
  refreshStatus,
  setup,
  login,
  onSessionExpired,
  resetAuthForTesting,
}

export function useAuth(): AuthCoordinator {
  return coordinator
}

export function isAuthApiError(error: unknown): error is AuthApiError {
  return Boolean(error && typeof error === 'object' && error instanceof Error && 'status' in error && 'body' in error)
}

export const authState = computed(() => state.value)
