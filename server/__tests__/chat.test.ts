import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../ai/chat'

describe('buildSystemPrompt', () => {
  it('returns the base prompt when no note context is provided', () => {
    expect(buildSystemPrompt({})).toBe(
      "You're a helpful assistant for a personal knowledge base."
    )
  })

  it('appends the current note path and content when ctx has both', () => {
    const out = buildSystemPrompt({
      currentNotePath: 'zettel/foo.md',
      currentNoteContent: 'hello world',
    })
    expect(out).toContain('zettel/foo.md')
    expect(out).toContain('hello world')
    expect(out.startsWith("You're a helpful assistant")).toBe(true)
  })

  it('truncates content at 20_000 chars and appends a marker', () => {
    const big = 'a'.repeat(25_000)
    const out = buildSystemPrompt({
      currentNotePath: 'zettel/big.md',
      currentNoteContent: big,
    })
    // The full 25_000 a's are not in the output — only the first 20_000.
    expect(out).toContain('a'.repeat(20_000))
    expect(out).not.toContain('a'.repeat(20_001))
    // Truncation marker is present, naming the file.
    expect(out).toContain('[... truncated; full file at zettel/big.md ...]')
  })

  it('does not truncate when content is exactly 20_000 chars', () => {
    const exact = 'b'.repeat(20_000)
    const out = buildSystemPrompt({
      currentNotePath: 'zettel/exact.md',
      currentNoteContent: exact,
    })
    expect(out).not.toContain('truncated')
  })
})
