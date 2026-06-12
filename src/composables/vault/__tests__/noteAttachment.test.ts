// Tests for the pure composeUserMessage helper. No Vue, no fetch —
// the cap and the block shape should be deterministic from inputs.
import { describe, it, expect } from 'vitest'
import {
  composeUserMessage,
  parseUserMessage,
  countCodepoints,
  MAX_NOTE_CODEPOINTS,
  ATTACHED_NOTE_TAG_OPEN,
  ATTACHED_NOTE_TAG_END,
} from '../noteAttachment'

describe('countCodepoints', () => {
  it('counts ASCII by code point (1 per char)', () => {
    expect(countCodepoints('hello')).toBe(5)
  })

  it('counts non-BMP characters as 1 each (not 2 UTF-16 units)', () => {
    // U+1F600 (grinning face) is a surrogate pair in UTF-16
    expect('😀'.length).toBe(2)
    expect(countCodepoints('😀')).toBe(1)
  })
})

describe('composeUserMessage', () => {
  it('returns the text verbatim when no path/content provided', () => {
    const out = composeUserMessage({ text: 'hi', path: '', content: '' })
    expect(out.userContent).toBe('hi')
    expect(out.noteAttachment).toBeUndefined()
  })

  it('returns the text verbatim when path is set but content is empty', () => {
    const out = composeUserMessage({ text: 'hi', path: 'inbox/foo.md', content: '' })
    expect(out.userContent).toBe('hi')
    expect(out.noteAttachment).toBeUndefined()
  })

  it('appends an <attached_note> block when both path and content are present', () => {
    const out = composeUserMessage({
      text: '请帮我看下',
      path: 'inbox/foo.md',
      content: 'hello world',
    })
    expect(out.userContent).toContain('请帮我看下')
    expect(out.userContent).toContain(ATTACHED_NOTE_TAG_OPEN + 'inbox/foo.md">')
    expect(out.userContent).toContain('hello world')
    expect(out.userContent).toContain(ATTACHED_NOTE_TAG_END)
    expect(out.noteAttachment).toEqual({
      path: 'inbox/foo.md',
      truncated: false,
      originalCodepoints: 11,
      attachedCodepoints: 11,
    })
  })

  it('separates the text and the block with a blank line', () => {
    const out = composeUserMessage({ text: 'hi', path: 'a.md', content: 'body' })
    expect(out.userContent).toMatch(/hi\n\n<attached_note/)
  })

  it('does not truncate when content is exactly at the cap', () => {
    const exact = 'a'.repeat(MAX_NOTE_CODEPOINTS)
    const out = composeUserMessage({ text: 't', path: 'p.md', content: exact })
    expect(out.noteAttachment?.truncated).toBe(false)
    expect(out.noteAttachment?.attachedCodepoints).toBe(MAX_NOTE_CODEPOINTS)
    expect(out.userContent).not.toContain('truncated')
  })

  it('truncates content at MAX_NOTE_CODEPOINTS and reports metadata', () => {
    const big = 'a'.repeat(MAX_NOTE_CODEPOINTS + 5_000)
    const out = composeUserMessage({ text: 't', path: 'p.md', content: big })
    expect(out.noteAttachment?.truncated).toBe(true)
    expect(out.noteAttachment?.originalCodepoints).toBe(MAX_NOTE_CODEPOINTS + 5_000)
    expect(out.noteAttachment?.attachedCodepoints).toBe(MAX_NOTE_CODEPOINTS)
    expect(out.userContent).toContain('[... truncated; full file at p.md ...]')
  })

  it('truncates on code-point boundaries, not UTF-16 code units (no split emoji)', () => {
    // Build content where the truncation boundary would land mid-pair.
    // We pad with ASCII to push the boundary, then add an emoji, then
    // more ASCII. The emoji should either be fully included or fully
    // excluded — never half.
    const padding = 'a'.repeat(MAX_NOTE_CODEPOINTS - 3)
    const content = padding + '😀' + 'b'.repeat(10) // 😀 = 1 code point, 2 UTF-16 units
    const out = composeUserMessage({ text: 't', path: 'p.md', content })
    expect(out.userContent).toContain('truncated')
    // The full prefix should be in the body (we appended the
    // truncation marker after slicing to MAX_NOTE_CODEPOINTS code
    // points). No half-emoji allowed.
    expect(out.userContent).toContain(padding)
    // The 'b's after the emoji were past the cap and must not
    // appear in the truncated body.
    expect(out.userContent).not.toContain('b'.repeat(10))
  })

  it('when text is empty/whitespace, the block is the only content', () => {
    const out = composeUserMessage({ text: '   ', path: 'a.md', content: 'body' })
    // The user message is just the block; the leading whitespace
    // should not create a leading blank line.
    expect(out.userContent.startsWith(ATTACHED_NOTE_TAG_OPEN)).toBe(true)
  })
})

// Inverse of composeUserMessage: parse a composed user-content
// string back into typed text + attached note body. The renderer
// uses this to show the typed text and a collapsible card for the
// note, instead of dumping the full body inline in the bubble.
describe('parseUserMessage', () => {
  it('returns the whole content as typedText for a plain user message', () => {
    const out = parseUserMessage('hello')
    expect(out.typedText).toBe('hello')
    expect(out.attachedNotePath).toBeUndefined()
    expect(out.attachedNoteBody).toBeUndefined()
  })

  it('splits a composed message into typed text + attached note', () => {
    const composed = composeUserMessage({ text: '请帮我看下', path: 'inbox/foo.md', content: 'body content' })
    const out = parseUserMessage(composed.userContent)
    expect(out.typedText).toBe('请帮我看下')
    expect(out.attachedNotePath).toBe('inbox/foo.md')
    expect(out.attachedNoteBody).toBe('body content')
  })

  it('handles messages with no typed text (note only)', () => {
    const composed = composeUserMessage({ text: '   ', path: 'inbox/foo.md', content: 'body' })
    const out = parseUserMessage(composed.userContent)
    expect(out.typedText).toBe('')
    expect(out.attachedNotePath).toBe('inbox/foo.md')
    expect(out.attachedNoteBody).toBe('body')
  })

  it('preserves newlines in the note body (multiline notes)', () => {
    const multiline = 'line 1\nline 2\nline 3\nline 4'
    const composed = composeUserMessage({ text: 't', path: 'p.md', content: multiline })
    const out = parseUserMessage(composed.userContent)
    expect(out.attachedNoteBody).toBe(multiline)
  })

  it('round-trips a truncated message (body includes the truncation marker)', () => {
    const big = 'a'.repeat(MAX_NOTE_CODEPOINTS + 5_000)
    const composed = composeUserMessage({ text: 't', path: 'p.md', content: big })
    const out = parseUserMessage(composed.userContent)
    expect(out.attachedNotePath).toBe('p.md')
    expect(out.attachedNoteBody).toContain('[... truncated; full file at p.md ...]')
    // The cap applies to the body, not the typed text.
    expect([...out.attachedNoteBody!].length).toBeLessThanOrEqual(MAX_NOTE_CODEPOINTS + 100) // marker overhead
  })

  it('falls back gracefully when the content is not a composed message', () => {
    // Manually-edited content, or content from an old version of
    // the app that didn't use the new tags — should still render.
    const out = parseUserMessage('manually edited content')
    expect(out.typedText).toBe('manually edited content')
    expect(out.attachedNotePath).toBeUndefined()
  })
})
