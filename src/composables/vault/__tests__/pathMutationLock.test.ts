import { describe, expect, it } from 'vitest'
import { createPathMutationLock } from '../pathMutationLock'

describe('createPathMutationLock', () => {
  it('atomically excludes overlapping Vault mutations and releases exact paths', () => {
    const lock = createPathMutationLock()
    const releaseCommit = lock.acquire(['inbox/a.md', 'inbox/b.md'])

    expect(releaseCommit).toBeTypeOf('function')
    expect(lock.canAcquire(['inbox/a.md'])).toBe(false)
    expect(lock.acquire(['inbox/a.md'])).toBeNull()
    const releaseOther = lock.acquire(['inbox/c.md'])
    expect(releaseOther).toBeTypeOf('function')

    releaseCommit?.()
    expect(lock.canAcquire(['inbox/a.md'])).toBe(true)
    expect(lock.has('inbox/a.md')).toBe(false)
    expect(lock.has('inbox/c.md')).toBe(true)
    releaseOther?.()
    expect(lock.paths.value.size).toBe(0)
  })
})
