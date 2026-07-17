// Pure tab UI presentation layer.
//
// Source of truth for everything the tab strip renders about a
// WorkspaceTab: the title shown in the strip, the optional full path
// shown in the tooltip, the save status text the user sees, and the
// aria-label a screen reader announces.
//
// All state is derived from DocumentSavePresentation (Edit-04) — no
// raw SaveStatus enum or `savingRevision`/`revision`/`savedRevision`
// fields are read here. The presentation module is the single place
// that decides which user-facing word each presentation status maps
// to, so the tab strip, tooltip, and aria-label can never drift.

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
  /** Title shown in the tab strip and as the strong line in the tooltip. */
  displayTitle: string
  /** Full path shown as the secondary line in the tooltip; null when
   *  the tab has no path (e.g. empty placeholder tab). */
  fullPath: string | null
  /** Save status word shown on its own line in the tooltip; null
   *  when the tab is read-only (history/diff). */
  statusText: string | null
  /** Status kind used to pick a glyph and tooltip row styling. 'none'
   *  means no badge (history/diff and idle/saved documents). */
  statusKind: TabUiStatusKind
  /** Short aria-label for the tab — title + status, joined by a
   *  space. Does NOT include the full path or operation hint (those
   *  are surfaced via the tooltip / aria-describedby instead so the
   *  screen reader doesn't have to read the whole sentence on every
   *  focus). */
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
 * Build the title shown in the tab strip from the document's
 *   1. display title (from frontmatter / metadata)
 *   2. last path segment (with .md extension stripped)
 *   3. full path
 *
 * The decision never modifies the underlying Tab — it only derives
 * a display string. Returns "" when both title and path are empty.
 */
export function deriveDisplayTitle(title: string, path: string): string {
  const trimmed = (title ?? '').trim()
  if (trimmed && trimmed !== path) return trimmed
  const lastSegment = path.split('/').pop() ?? ''
  if (lastSegment) return stripMarkdownExtension(lastSegment)
  return path
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
  statusText: string | null,
): string {
  return statusText ? `${displayTitle} ${statusText}` : displayTitle
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
    const displayTitle = deriveDisplayTitle(tab.title, tab.id)
    const fullPath = deriveFullPath('document', tab.id)
    const statusText = tab.save ? statusTextForPresentation(tab.save, t) : null
    return {
      displayTitle,
      fullPath,
      statusText,
      statusKind: tab.save ? statusKindFor(tab.save.status) : 'none',
      ariaLabel: buildAriaLabel(displayTitle, statusText),
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