import path from 'node:path'
import { SEGMENT_RE } from '../paths.js'

const FILE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.md$/
// Git object ids are SHA-1 today. If the vault repo switches to SHA-256,
// raise the upper bound from 40 to 64.
const SHA_RE = /^[0-9a-f]{7,40}$/i
const HEAD_RE = /^HEAD(?:~[1-9][0-9]*)?$/

export const MANAGED_HISTORY_DOTFILES = new Set(['.gitattributes', '.gitignore'])

export function isManagedHistoryPath(filePath: string): boolean {
  return MANAGED_HISTORY_DOTFILES.has(filePath)
}

export function isValidHistoryPath(filePath: string): boolean {
  if (!filePath || filePath.includes('\0')) return false
  if (filePath.includes('\\') || path.isAbsolute(filePath)) return false
  if (filePath !== path.posix.normalize(filePath)) return false
  if (filePath === '.' || filePath === '..' || filePath.endsWith('/')) return false
  if (filePath.split('/').some((part) => part.startsWith('.'))) return false

  const parts = filePath.split('/')
  const file = parts.pop()
  if (!file || !FILE_RE.test(file)) return false
  return parts.every((part) => SEGMENT_RE.test(part))
}

export function isValidHistoryRef(ref: string, opts: { allowWorktree?: boolean } = {}): boolean {
  if (!ref || ref.includes('\0')) return false
  if (opts.allowWorktree && ref === 'WORKTREE') return true
  return SHA_RE.test(ref) || HEAD_RE.test(ref)
}

export function validateHistoryPaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const paths: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) return null
    if (!isValidHistoryPath(item)) return null
    paths.push(item)
  }
  return paths
}
