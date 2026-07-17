import { describe, expect, it } from 'vitest'
import {
  pendingDocumentWriteLocksForTesting,
  withDocumentWriteLock,
} from '../documentWriteLock'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('withDocumentWriteLock', () => {
  it('serializes the same path and clears the completed entry', async () => {
    const firstStarted = deferred()
    const releaseFirst = deferred()
    const order: string[] = []
    const first = withDocumentWriteLock('a', async () => {
      order.push('first-start')
      firstStarted.resolve()
      await releaseFirst.promise
      order.push('first-end')
    })
    await firstStarted.promise
    const second = withDocumentWriteLock('a', async () => {
      order.push('second')
    })

    await Promise.resolve()
    expect(order).toEqual(['first-start'])
    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
    expect(pendingDocumentWriteLocksForTesting()).toBe(0)
  })

  it('allows different paths to run concurrently', async () => {
    const releaseA = deferred()
    const aStarted = deferred()
    const seen: string[] = []
    const a = withDocumentWriteLock('a', async () => {
      seen.push('a')
      aStarted.resolve()
      await releaseA.promise
    })
    await aStarted.promise
    const b = withDocumentWriteLock('b', async () => {
      seen.push('b')
    })

    await b
    expect(seen).toEqual(['a', 'b'])
    releaseA.resolve()
    await a
    expect(pendingDocumentWriteLocksForTesting()).toBe(0)
  })

  it('does not strand later requests after a rejection', async () => {
    await expect(withDocumentWriteLock('a', async () => {
      throw new Error('failed')
    })).rejects.toThrow('failed')

    await expect(withDocumentWriteLock('a', async () => 'ok')).resolves.toBe('ok')
    expect(pendingDocumentWriteLocksForTesting()).toBe(0)
  })
})
