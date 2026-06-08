// @vitest-environment jsdom
// Tests for the file-change pub-sub bus. Exercises the publish /
// get-bus flow, the monotonic seq counter, and the test escape
// hatches. The bus is consumed in production by useEditorTabs and
// useCurrentNote; this file pins the producer-side contract.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { watch } from 'vue'
import {
  publishFileChange,
  getFileChangeBus,
  __resetFileChangeBusForTesting,
} from '../useFileChangeBus'

beforeEach(() => {
  __resetFileChangeBusForTesting()
})

afterEach(() => {
  __resetFileChangeBusForTesting()
})

describe('useFileChangeBus', () => {
  it('returns a stable ref from getFileChangeBus from the start', () => {
    const ref = getFileChangeBus()
    expect(ref).not.toBeNull()
    expect(ref.value).toEqual([])
    // Same ref on subsequent calls.
    expect(getFileChangeBus()).toBe(ref)
  })

  it('appends events with monotonically increasing seq', () => {
    publishFileChange({ path: 'a.md', kind: 'write' })
    publishFileChange({ path: 'b.md', kind: 'delete' })
    publishFileChange({ path: 'c.md', kind: 'rename', oldPath: 'a.md' })
    const bus = getFileChangeBus()
    expect(bus.value).toHaveLength(3)
    expect(bus.value.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(bus.value[0]).toMatchObject({ path: 'a.md', kind: 'write', seq: 1 })
    expect(bus.value[1]).toMatchObject({ path: 'b.md', kind: 'delete', seq: 2 })
    expect(bus.value[2]).toMatchObject({ path: 'c.md', kind: 'rename', oldPath: 'a.md', seq: 3 })
  })

  it('triggers shallowRef watchers exactly once per publish', async () => {
    const watcher = vi.fn()
    publishFileChange({ path: 'a.md', kind: 'write' })
    const bus = getFileChangeBus()
    watch(bus, watcher, { flush: 'post' })
    publishFileChange({ path: 'b.md', kind: 'write' })
    await Promise.resolve()
    expect(watcher).toHaveBeenCalledTimes(1)
    const [newVal] = watcher.mock.calls[0]
    expect(newVal).toHaveLength(2)
    expect(newVal[0]).toMatchObject({ path: 'a.md', seq: 1 })
    expect(newVal[1]).toMatchObject({ path: 'b.md', seq: 2 })
  })

  it('preserves prior events across multiple publishes (append, not replace)', () => {
    publishFileChange({ path: 'a.md', kind: 'write' })
    publishFileChange({ path: 'b.md', kind: 'write' })
    publishFileChange({ path: 'c.md', kind: 'write' })
    const events = getFileChangeBus().value
    expect(events.map((e) => e.path)).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('__resetFileChangeBusForTesting clears events and resets the seq counter', () => {
    publishFileChange({ path: 'a.md', kind: 'write' })
    publishFileChange({ path: 'b.md', kind: 'write' })
    expect(getFileChangeBus().value).toHaveLength(2)
    __resetFileChangeBusForTesting()
    expect(getFileChangeBus().value).toEqual([])
    publishFileChange({ path: 'c.md', kind: 'write' })
    // seq counter restarts at 1.
    expect(getFileChangeBus().value[0].seq).toBe(1)
  })
})
