// Pure helpers for the 📎 "attach current note" toggle on the AI
// panel composer. Kept separate from useAiHistory so it can be unit
// tested without standing up a Vue composable harness, and so the
// truncation rules live in exactly one place.
//
// The cap (20K code points) is the same as the old server-side
// prompt-injection cap used to be — it's the point past which a
// single note reliably overwhelms the model's attention, and the
// point past which a single user turn starts to feel expensive.
// Code-point counting (not code-unit) so a surrogate pair (e.g. an
// emoji) can't be split mid-character.
import type { NoteAttachment } from '../../lib/ai-api.js'

export const MAX_NOTE_CODEPOINTS = 20_000

// Count Unicode code points. `string.length` would count UTF-16
// code units, which would split a surrogate pair. Spreading is the
// simplest reliable way to count code points in plain JS.
export function countCodepoints(s: string): number {
  return [...s].length
}

// The exact block we splice into the user message when the toggle
// is on. The tags are lowercase, hyphenated, and ASCII-only so the
// model can pattern-match on them. The path appears both as an
// attribute (for the model) and inside the marker (for the human
// scrolling back).
export const ATTACHED_NOTE_TAG_OPEN = '<attached_note path="'
export const ATTACHED_NOTE_TAG_CLOSE = '">'
export const ATTACHED_NOTE_TAG_END = '</attached_note>'

export type ComposeInput = {
  text: string
  path: string
  content: string
}

export type ComposeResult = {
  // The user-content string to send. Always starts with `text`; if
  // `path`/`content` were supplied and non-empty, the note is
  // appended as a clearly-marked block.
  userContent: string
  // The metadata to persist alongside the user message row. When
  // no note was attached, this is undefined (so the server
  // doesn't write a useless note_attachment cell).
  noteAttachment: NoteAttachment | undefined
}

/**
 * Compose the final user-content string + attachment metadata.
 *
 * - Empty/whitespace `text` → empty `userContent` and no attachment
 *   (the caller should reject this earlier; we just return safely).
 * - Empty `path` or empty `content` → no attachment (the toggle was
 *   on but there's nothing to attach).
 * - Otherwise: append the note as an <attached_note> block, capped
 *   at MAX_NOTE_CODEPOINTS with a `[... truncated; full file at
 *   <path> ...]` marker if it would have overflowed.
 *
 * The `text` is preserved verbatim — the note block is appended
 * after a blank line so the model can clearly see where the
 * user-typed portion ends and the attached material begins.
 */
export function composeUserMessage(input: ComposeInput): ComposeResult {
  const text = input.text
  const path = input.path
  const content = input.content
  if (!path || !content) {
    return { userContent: text, noteAttachment: undefined }
  }
  const originalCodepoints = countCodepoints(content)
  const cps = [...content]
  const truncated = cps.length > MAX_NOTE_CODEPOINTS
  const body = truncated
    ? cps.slice(0, MAX_NOTE_CODEPOINTS).join('') +
      `\n[... truncated; full file at ${path} ...]\n`
    : content
  // Wrap with a trailing newline before </attached_note> so the
  // model can see the boundary clearly even if the note didn't end
  // with one.
  const block =
    `${ATTACHED_NOTE_TAG_OPEN}${path}${ATTACHED_NOTE_TAG_CLOSE}\n` +
    body +
    (body.endsWith('\n') ? '' : '\n') +
    ATTACHED_NOTE_TAG_END
  // Match the style of the existing prompt-injection line: a
  // blank-line separator between the user's text and the block.
  const userContent = text.trim().length === 0
    ? block
    : `${text}\n\n${block}`
  return {
    userContent,
    noteAttachment: {
      path,
      truncated,
      originalCodepoints,
      attachedCodepoints: truncated ? MAX_NOTE_CODEPOINTS : originalCodepoints,
    },
  }
}

// Inverse of composeUserMessage: takes a composed user-content
// string and splits it back into the typed text + the attached
// note body. Used by the message renderer so the bubble can show
// the typed text separately from a collapsible "attached note"
// card, instead of dumping the full note body inline (which made
// it look like the model received the whole note on every send).
//
// Shape recognized:
//   - "<text>\n\n<attached_note path="...">\n<body>\n</attached_note>"
//   - "<attached_note path="...">\n<body>\n</attached_note>"   (no text)
// If the content doesn't match (e.g. user manually edited the
// markdown file and broke the tags), the parser falls back to
// returning the whole content as `typedText` and leaves the
// note fields undefined — the renderer shows the raw content.
const USER_MESSAGE_RE = /^(?:([\s\S]*?)\n\n)?<attached_note path="([^"]+)">\n([\s\S]*?)\n<\/attached_note>\s*$/

export type ParsedUserMessage = {
  typedText: string
  attachedNotePath?: string
  attachedNoteBody?: string
}

export function parseUserMessage(content: string): ParsedUserMessage {
  const m = content.match(USER_MESSAGE_RE)
  if (!m) return { typedText: content }
  return {
    typedText: (m[1] ?? '').trim(),
    attachedNotePath: m[2],
    attachedNoteBody: m[3],
  }
}
