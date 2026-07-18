// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from '../workspaceTabActions'

describe('Workspace tab path actions', () => {
  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await copyTextToClipboard('inbox/a', { writeText })).toBe(true)
    expect(writeText).toHaveBeenCalledWith('inbox/a')
  })

  it('falls back when Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    expect(await copyTextToClipboard('inbox/a', { writeText }, document)).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('reports failure when neither clipboard path succeeds', async () => {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    })
    expect(await copyTextToClipboard('inbox/a', undefined, document)).toBe(false)
  })
})
