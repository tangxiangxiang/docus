// Line-level + word-level diff for the history feature.
//
// Pure functions, no I/O. The L0 git wrapper gives us two raw strings
// ("old" and "new" versions of a file at two refs); L1 turns them
// into a structured `FileDiff` that the L2 renderer can map 1:1 to
// DOM rows.
//
// Why Myers (via kpdecker `diff`): the diff package is the de-facto
// line-diff library for Node. It gives us a stable, well-tested
// implementation of Myers' algorithm with no platform dependencies,
// and exposes a `diffLines` API that returns ops tagged `added` /
// `removed` / nothing (equal). We then post-process those ops into
// the shape we actually need: line numbers on both sides, plus a
// stats object the timeline view can show ("+12 -3").
//
// Word-level diff: when a removed line and an added line are
// adjacent in the line-diff output AND we suspect they are
// "the same line, edited" (heuristic below), we run `diffWords` on
// the pair and attach the resulting intra-line ops to both. The L2
// renderer uses those to highlight the changed substring in the
// gutter. If we don't recognize the pair, we just emit the lines
// plain and the renderer shows them as full-block add/remove.
//
// Line-ending policy: the old and new strings come from git
// (rawAt) or the working tree, both of which should now be LF-only
// after `core.autocrlf=false` and our empty `.gitattributes`. We
// still tolerate CRLF here defensively — `\r` is stripped from
// input so the diff is computed on LF lines, then we re-emit the
// result with LF. The two-stage split also avoids a class of bugs
// where Myers' LCS treats `\r\n` and `\n` as different lines.

import { diffLines, diffWordsWithSpace, type Change } from 'diff'

export type OpKind = 'equal' | 'add' | 'remove'

/**
 * One row in the rendered diff. `oldLine` and `newLine` are 1-based
 * line numbers in the original old/new content (or null for a line
 * that exists on only one side). `words` is the optional word-level
 * breakdown for highlighted render — it has the same shape as `ops`
 * but is constrained to a single line.
 */
export type DiffOp = {
  op: OpKind
  oldLine: number | null
  newLine: number | null
  text: string
  words?: DiffOp[]
}

export type FileDiff = {
  ops: DiffOp[]
  stats: { added: number; removed: number; equal: number }
}

/**
 * Convert a raw kpdecker `Change` into a single row of the diff
 * view. Text is split into lines and the trailing newline is
 * discarded — the renderer reconstructs the visual line break.
 */
function changeToOp(
  ch: Change,
  oldLineStart: number,
  newLineStart: number,
): { op: OpKind; oldLineStart: number; newLineStart: number; lines: { text: string; oldLine: number | null; newLine: number | null }[] } {
  const op: OpKind = ch.added ? 'add' : ch.removed ? 'remove' : 'equal'
  // kpdecker returns text WITH trailing newline. Splitting on \n and
  // dropping the last empty entry gives us one entry per visual line.
  const parts = ch.value.split('\n')
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  const lines: { text: string; oldLine: number | null; newLine: number | null }[] = []
  let o = oldLineStart
  let n = newLineStart
  for (const text of parts) {
    lines.push({
      text,
      oldLine: op === 'add' ? null : o,
      newLine: op === 'remove' ? null : n,
    })
    if (op !== 'add') o++
    if (op !== 'remove') n++
  }
  return { op, oldLineStart: o, newLineStart: n, lines }
}

/**
 * Heuristic: are these two ops a "the same line, edited" pair? If so,
 * the L2 renderer can do a word-level diff on them. The conditions:
 *   - one `remove` line followed by one `add` line
 *   - same number of lines on each side
 *   - the text isn't wildly different (Levenshtein ratio > 0.5)
 *
 * The ratio gate is the load-bearing one: it stops the renderer from
 * doing word-level diffs on completely unrelated lines that just
 * happen to be adjacent (e.g. a deleted paragraph and a brand new
 * one). 0.5 is a soft threshold; on a single-line pair it's the same
 * as saying "at least 50% of the characters overlap".
 */
function looksLikeEditPair(removed: DiffOp, added: DiffOp): boolean {
  if (removed.op !== 'remove' || added.op !== 'add') return false
  // Multi-line block: skip the optimization, render as full rows.
  // (Word-level diff across multiple lines is expensive and rare.)
  if (removed.text.includes('\n') || added.text.includes('\n')) return false
  const a = removed.text
  const b = added.text
  if (a.length === 0 || b.length === 0) return false
  // Quick length-ratio gate — if one side is 3x longer than the
  // other, this is almost certainly a replacement, not an edit.
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
  return ratio >= 0.5
}

/**
 * Cheap character-set similarity: |chars(a) ∩ chars(b)| / |chars(a) ∪ chars(b)|.
 * Sørensen–Dice on character sets, lowercased so case-only edits
 * (e.g. `line two` → `LINE TWO`) still register as "the same
 * line, edited" rather than "completely different". This is
 * intentionally a SET overlap, not a multiset: the goal is to
 * decide whether the two lines share enough vocabulary to be
 * worth a word-level breakdown, not to measure actual edit
 * distance.
 *
 * Why not Levenshtein: O(n*m) and the result is a count, not a
 * normalized score — we'd have to divide by max(|a|, |b|) anyway,
 * at which point the Sørensen–Dice on character sets is both
 * cheaper and more robust to length differences.
 */
function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1
  const sa = a.toLowerCase()
  const sb = b.toLowerCase()
  const set = new Set<string>()
  for (const ch of sa) set.add(ch)
  let inter = 0
  let union = set.size
  for (const ch of sb) {
    if (set.has(ch)) {
      inter++
    } else {
      union++
    }
  }
  if (union === 0) return 0
  return inter / union
}

/**
 * Pair adjacent remove+add rows into word-level diffs. Mutates the
 * `words` field on each op. Operates on the post-line-diff array so
 * a multi-line add/remove block is left as-is.
 */
function annotateWordDiffs(ops: DiffOp[]): void {
  for (let i = 0; i + 1 < ops.length; i++) {
    const a = ops[i]
    const b = ops[i + 1]
    if (!looksLikeEditPair(a, b)) continue
    if (similarity(a.text, b.text) < 0.5) continue
    const wordChanges = diffWordsWithSpace(a.text, b.text)
    // Wrap the per-line text into a single op with words[] set.
    a.words = []
    for (const w of wordChanges) {
      if (w.added) continue // the added half lives on the b op
      a.words.push({
        op: w.removed ? 'remove' : 'equal',
        oldLine: a.oldLine,
        newLine: a.newLine,
        text: w.value,
      })
    }
    b.words = []
    for (const w of wordChanges) {
      if (w.removed) continue
      b.words.push({
        op: w.added ? 'add' : 'equal',
        oldLine: a.oldLine,
        newLine: a.newLine,
        text: w.value,
      })
    }
  }
}

/**
 * Normalize a content string into LF lines. Defensive against the
 * (now-fixed) CRLF slip-through. We split into lines so the kpdecker
 * diff sees the same shape regardless of which platform wrote the
 * file. We don't unify trailing-newline differences — if a file
 * went from `"a\nb"` to `"a\nb\n"`, that's a real one-line add of
 * an empty line and the diff will show it.
 */
function normalize(s: string): string {
  return s.replace(/\r\n/g, '\n')
}

/**
 * Compute a line-level + word-level diff between two file contents.
 * `oldContent` may be null (file did not exist at the old ref) —
 * treated as a fully-empty file so the result is a pure `add` of
 * the new content. Same in reverse for `newContent === null`.
 *
 * Empty inputs are handled cheaply: both empty → empty FileDiff;
 * one empty → the other side in full as added/removed.
 */
export function computeFileDiff(oldContent: string | null, newContent: string | null): FileDiff {
  // Cheap path: identical (or both null/empty). String compare
  // avoids spinning up Myers on a no-op.
  if (oldContent === newContent) {
    return { ops: [], stats: { added: 0, removed: 0, equal: 0 } }
  }

  const a = normalize(oldContent ?? '')
  const b = normalize(newContent ?? '')

  // We don't pass a third options arg: kpdecker `diff` 9.x reads
  // `options.config` before the rest, and a missing `config` key
  // throws "Cannot read properties of undefined (reading 'config')".
  // The default behavior (newlineIsToken=false) is what we want.
  const changes = diffLines(a, b)

  const ops: DiffOp[] = []
  let oldLine = 1
  let newLine = 1
  let added = 0
  let removed = 0
  let equal = 0

  for (const ch of changes) {
    const out = changeToOp(ch, oldLine, newLine)
    oldLine = out.oldLineStart
    newLine = out.newLineStart
    for (const line of out.lines) {
      ops.push({ op: out.op, oldLine: line.oldLine, newLine: line.newLine, text: line.text })
      if (out.op === 'add') added++
      else if (out.op === 'remove') removed++
      else equal++
    }
  }

  annotateWordDiffs(ops)

  return { ops, stats: { added, removed, equal } }
}
