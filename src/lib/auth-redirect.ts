const REDIRECT_FALLBACK = '/vault'
const REDIRECT_ORIGIN = 'http://docus.internal'

function decodeFully(value: string): string | null {
  let current = value
  for (let i = 0; i < 3; i += 1) {
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      return null
    }
    if (decoded === current) return current
    current = decoded
  }
  // A fourth pass would indicate a deliberately nested encoding rather than
  // a normal router query. Reject it instead of guessing at its meaning.
  try {
    if (decodeURIComponent(current) !== current) return null
  } catch {
    return null
  }
  return current
}

/**
 * Normalize a redirect supplied by a login/setup route to a same-origin
 * workspace path. Invalid, external, scheme-relative, backslash-containing,
 * and malformed values all resolve to the safe vault root.
 */
export function safeInternalRedirect(value: unknown, fallback = REDIRECT_FALLBACK): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return fallback
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback
  const decoded = decodeFully(value)
  if (!decoded || /[\u0000-\u001f\u007f\\]/.test(decoded)) return fallback

  let url: URL
  try {
    url = new URL(decoded, REDIRECT_ORIGIN)
  } catch {
    return fallback
  }
  if (url.origin !== REDIRECT_ORIGIN || url.username || url.password) return fallback
  if (url.pathname !== '/' && url.pathname !== '/vault' && !url.pathname.startsWith('/vault/')) return fallback
  return `${url.pathname}${url.search}${url.hash}` || fallback
}

export function isSafeInternalRedirect(value: unknown): value is string {
  return typeof value === 'string' && safeInternalRedirect(value, '') === value
}
