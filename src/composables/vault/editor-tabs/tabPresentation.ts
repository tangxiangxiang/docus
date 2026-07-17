// Pure tab UI presentation layer.
//
// Source of truth for everything the tab strip renders about a
// WorkspaceTab: the title shown in the strip, the optional document
// title (metadata/frontmatter) shown in the tooltip, the full path,
// the save status text the user sees, and the aria-label.
//
// Two separate fields keep the strip and the tooltip coherent when
// the upstream WorkspaceTab carries both a `label` (the file basename
// in kebab-case) and a `title` (the metadata/frontmatter title, which
// may be in any language):
//
//   - `displayTitle` comes from `label` and is what the tab strip
//     shows. It is always the file basename (or path fallback when
//     label is empty), so the tab strip language stays uniform
//     across all documents regardless of metadata title.
//
//   - `documentTitle` comes from `title` and is only surfaced in the
//     tooltip as an optional supplementary line. It is suppressed in
//     every case where it would just duplicate `displayTitle` (equal
//     to it, equal to the path, or its `.md`-stripped form equals
//     displayTitle).
//
// All status text is derived from DocumentSavePresentation (Edit-04)
// — no raw SaveStatus enum or `savingRevision`/`revision`/
// `savedRevision` fields are read here.

import type { WorkspaceTab } from '../../../components/vault/tabs'
import type {
  DocumentSavePresentation,
  SavePresentationStatus,
} from './savePresentation'

export type TabUiStatusKind =
  | 'none'
  | 'dirty'
  | 'saving'
  | 'error'
  | 'offline'
  | 'external'

export interface TabUiPresentation {
  /** Title shown in the tab strip and as the strong line in the tooltip.
   *  Always derived from `tab.label` (file basename) so the strip's
   *  language and shape stay uniform across documents. */
  displayTitle: string
  /** Document title from metadata / frontmatter. Surfaced only in the
   *  tooltip as an optional supplementary line. null when the title
   *  is empty, equals the path, or duplicates `displayTitle`. */
  documentTitle: string | null
  /** Full path shown as the secondary line in the tooltip; null when
   *  the tab has no path (history/diff). */
  fullPath: string | null
  /** Save status word shown on its own line in the tooltip; null
   *  when the tab is read-only (history/diff). */
  statusText: string | null
  /** Status kind used to pick a glyph and tooltip row styling. 'none'
   *  means no badge (history/diff and idle/saved documents). */
  statusKind: TabUiStatusKind
  /** Short aria-label for the tab. When the document has a separate
   *  metadata title, the aria-label includes "<documentTitle>, file
   *  <displayTitle>, <status>" so screen readers can announce both
   *  the file identity and the human-readable title. Without a
   *  document title it falls back to "<displayTitle>, <status>". */
  ariaLabel: string
}

/**
 * Translate a presentation status into a user-facing word.
 *
 * `idle` and `saved` collapse to "Saved" so the UI never has to
 * differentiate "no save ever" from "save succeeded" — both are
 * the steady state the user is looking for.
 */
export function statusText(
  presentationStatus: SavePresentationStatus,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (presentationStatus) {
    case 'idle':
    case 'saved':
      return t('status.saved')
    case 'dirty':
      return t('status.unsaved')
    case 'saving':
      return t('status.saving')
    case 'saving-dirty':
      return t('status.saving_dirty')
    case 'error':
      return t('status.error')
    case 'offline':
      return t('status.offline')
    case 'external':
      return t('status.external')
  }
}

function statusKindFor(presentationStatus: SavePresentationStatus): TabUiStatusKind {
  switch (presentationStatus) {
    case 'idle':
    case 'saved':
      return 'none'
    case 'dirty':
      return 'dirty'
    case 'saving':
    case 'saving-dirty':
      return 'saving'
    case 'error':
      return 'error'
    case 'offline':
      return 'offline'
    case 'external':
      return 'external'
  }
}

function stripMarkdownExtension(segment: string): string {
  return segment.endsWith('.md') ? segment.slice(0, -3) : segment
}

/**
 * Build the title shown in the tab strip from the WorkspaceTab's
 * `label` (the upstream basename). When label is empty, fall back
 * to the last path segment with the .md extension stripped.
 *
 * The presentation NEVER falls back to `tab.title` (the metadata /
 * frontmatter title) here — that field is a separate language and
 * can produce mixed-language tabs if it ever wins. Use
 * `documentTitle` for the optional tooltip line that surfaces the
 * metadata title.
 */
export function deriveDisplayTitle(label: string, path: string): string {
  const trimmed = (label ?? '').trim()
  if (trimmed) return stripMarkdownExtension(trimmed)
  const lastSegment = path.split('/').pop() ?? ''
  if (lastSegment) return stripMarkdownExtension(lastSegment)
  return path
}

/**
 * Compute the optional document title for the tooltip line. Returns
 * null when the title would be redundant with the displayTitle or
 * the path. Specifically:
 *   - empty / whitespace-only title
 *   - title equals the full path
 *   - title equals displayTitle
 *   - title with .md extension stripped equals displayTitle
 */
export function deriveDocumentTitle(
  title: string,
  path: string,
  displayTitle: string,
): string | null {
  const trimmed = (title ?? '').trim()
  if (!trimmed) return null
  if (trimmed === path) return null
  if (trimmed === displayTitle) return null
  if (stripMarkdownExtension(trimmed) === displayTitle) return null
  return trimmed
}

/**
 * Build the path shown in the tooltip. Returns null for non-document
 * tabs (history/diff) since the spec says history/diff should not
 * display the document save state — and that means the path lives
 * implicitly in the title rather than as its own line.
 */
export function deriveFullPath(kind: WorkspaceTab['kind'], path: string): string | null {
  if (kind !== 'document') return null
  return path || null
}

function buildAriaLabel(
  displayTitle: string,
  documentTitle: string | null,
  statusText: string | null,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const sep = t('workspace_tab.aria_separator')
  if (documentTitle) {
    const filePart = t('workspace_tab.aria_file', { name: displayTitle })
    const parts = [documentTitle, filePart]
    if (statusText) parts.push(statusText)
    return parts.join(sep)
  }
  const parts = [displayTitle]
  if (statusText) parts.push(statusText)
  return parts.join(sep)
}

/**
 * Compose the full UI presentation for a single workspace tab.
 *
 *   - Document tabs get a title, a path, a status word, and an
 *     aria-label that includes the title + status.
 *   - History/diff tabs get just a title (their existing label)
 *     and no status — they are read-only and the spec says they
 *     must not surface document save state.
 *
 * Pass `t` in explicitly so this pure function stays testable
 * without mounting a component.
 */
export function deriveTabUiPresentation(
  tab: WorkspaceTab,
  t: (key: string, params?: Record<string, string | number>) => string,
): TabUiPresentation {
  if (tab.kind === 'document') {
    const displayTitle = deriveDisplayTitle(tab.label ?? '', tab.id)
    const documentTitle = deriveDocumentTitle(tab.title ?? '', tab.id, displayTitle)
    const fullPath = deriveFullPath('document', tab.id)
    const statusText = tab.save ? statusTextForPresentation(tab.save, t) : null
    return {
      displayTitle,
      documentTitle,
      fullPath,
      statusText,
      statusKind: tab.save ? statusKindFor(tab.save.status) : 'none',
      ariaLabel: buildAriaLabel(displayTitle, documentTitle, statusText, t),
    }
  }
  // History / diff tabs keep their existing title semantics — the
  // WorkspaceTab shape provides a separate `label` (the user-facing
  // text shown in the tab strip, e.g. "Redis Notes (History)") and a
  // plain `title`. We surface the label here so the tab strip and
  // aria-label stay aligned with the legacy layout.
  const displayTitle = (tab.label ?? tab.title ?? '').trim() || tab.title || ''
  return {
    displayTitle,
    documentTitle: null,
    fullPath: null,
    statusText: null,
    statusKind: 'none',
    ariaLabel: displayTitle,
  }
}

function statusTextForPresentation(
  save: DocumentSavePresentation,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  return statusText(save.status, t)
}