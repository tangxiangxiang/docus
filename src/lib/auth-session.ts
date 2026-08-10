/**
 * Shared, deliberately narrow observation seam for the Docus session.
 *
 * This module does not own navigation and it never replaces global fetch.
 * Protected API wrappers call `observeAuthSessionResponse` after receiving a
 * response.  The observer reads a clone so each feature-specific parser keeps
 * ownership of the original response body.
 */

export const AUTH_SESSION_REQUIRED_CODE = 'auth-session-required' as const

export type AuthSessionRequiredEvent = {
  /** Request epoch captured when the protected request started. */
  readonly generation: number
}

type Listener = (event: AuthSessionRequiredEvent) => void

let generation = 0
const listeners = new Set<Listener>()

/** Capture the current request epoch before starting a protected fetch. */
export function captureAuthSessionGeneration(): number {
  return generation
}

/** Advance the epoch when a successful auth transition supersedes old work. */
export function advanceAuthSessionGeneration(): number {
  generation += 1
  return generation
}

export function subscribeAuthSessionRequired(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function responseCode(response: Response): Promise<unknown> {
  try {
    const body = await response.clone().json() as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
    return (body as { code?: unknown }).code
  } catch {
    return undefined
  }
}

/**
 * Return true only for the Docus-owned session-expiry contract.
 * HTTP status alone is intentionally insufficient: provider authentication
 * failures also use 401 in the AI API.
 */
export async function isAuthSessionRequiredResponse(response: Response): Promise<boolean> {
  if (response.status !== 401) return false
  return await responseCode(response) === AUTH_SESSION_REQUIRED_CODE
}

/**
 * Observe a response and notify subscribers when it is a Docus session
 * expiry.  The original response remains readable by the caller.
 */
export async function observeAuthSessionResponse(
  response: Response,
  requestGeneration = captureAuthSessionGeneration(),
): Promise<boolean> {
  if (!await isAuthSessionRequiredResponse(response)) return false
  const event = { generation: requestGeneration } satisfies AuthSessionRequiredEvent
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // An observation subscriber must never break the feature-specific
      // parser that still owns the original response.
    }
  }
  return true
}

/**
 * Fetch helper for protected application wrappers.  It captures the epoch at
 * request start, then observes the response without consuming its body.
 */
export async function authFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const requestGeneration = captureAuthSessionGeneration()
  const response = init === undefined ? await fetch(input) : await fetch(input, init)
  await observeAuthSessionResponse(response, requestGeneration)
  return response
}

/** Test-only reset; no production code relies on this. */
export function resetAuthSessionForTesting(): void {
  generation = 0
  // Keep production subscribers (notably useAuth's singleton coordinator)
  // installed when a test resets the request epoch.
}
