import { describe, expect, it } from 'vitest'
import {
  blockedMessage,
  canCreateFileChild,
  canModify,
  canMove,
  isInArchive,
  isProtectedRoot,
  readonlyReason,
} from '../archiveProtocol'

const t = (key: string) => key

describe('Archive Soft-Policy protocol', () => {
  it('keeps the three top-level system roots protected', () => {
    for (const root of ['inbox', 'literature', 'archive']) {
      expect(isProtectedRoot(root)).toBe(true)
      expect(canModify(root)).toBe(false)
      expect(canMove(root)).toBe(false)
      expect(blockedMessage(root, 'rename', t)).not.toBeNull()
      expect(blockedMessage(root, 'delete', t)).not.toBeNull()
      expect(blockedMessage(root, 'move', t)).not.toBeNull()
      expect(canCreateFileChild(root)).toBe(true)
      expect(blockedMessage(root, 'create-file', t)).toBeNull()
      expect(blockedMessage(root, 'create-folder', t)).toBeNull()
    }
  })

  it('treats archive descendants as ordinary editable content', () => {
    expect(isInArchive('archive/foo.md')).toBe(true)
    expect(isInArchive('archive/folder/foo.md')).toBe(true)
    expect(isProtectedRoot('archive/foo.md')).toBe(false)
    expect(readonlyReason('archive')).toBe('root')
    expect(readonlyReason('archive/foo.md')).toBeNull()

    expect(canModify('archive/foo.md')).toBe(true)
    expect(canModify('archive/folder/foo.md')).toBe(true)
    expect(canMove('archive/foo.md')).toBe(true)
    expect(canMove('archive/folder')).toBe(true)
    expect(canCreateFileChild('archive')).toBe(true)
    expect(canCreateFileChild('archive/folder')).toBe(true)

    for (const [path, op] of [
      ['archive/foo.md', 'rename'],
      ['archive/foo.md', 'delete'],
      ['archive/foo.md', 'move'],
      ['archive/folder', 'create-file'],
    ] as const) {
      expect(blockedMessage(path, op, t)).toBeNull()
    }
  })
})
