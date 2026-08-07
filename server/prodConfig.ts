export const DEFAULT_HOST = '127.0.0.1'

/** Resolve the listener address without widening a bare-metal install. */
export function resolveServerHost(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HOST?.trim()
  return configured || DEFAULT_HOST
}
