// Inline SVG icon strings for the file tree. Kept as raw strings (not Vue components)
// so they can be inlined into existing v-html bindings without per-icon import cost.
//
// Unified visual system (all functional icons follow this):
//   viewBox        0 0 16 16
//   display size   14 × 14
//   stroke         currentColor
//   stroke-width   1.5
//   stroke caps    round
//   stroke joins   round
//   fill           none (except where a small dot/hole is intentional)
//   visual center  (8, 8); bounds usually within (2, 14)
//
// Allowed exceptions: brand logos, status dots, glyphs that must read as filled.

export const ICON_FOLDER = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 4.5C2 3.67 2.67 3 3.5 3h3l1.5 1.5h4.5c.83 0 1.5.67 1.5 1.5v6.5c0 .83-.67 1.5-1.5 1.5h-9C2.67 13.5 2 12.83 2 12V4.5z"/>
</svg>`

export const ICON_FOLDER_OPEN = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 4.5C2 3.67 2.67 3 3.5 3h3l1.5 1.5h4.5c.83 0 1.5.67 1.5 1.5H2V4.5z"/>
  <path d="M2 5h12.5l-1.5 7c-.1.5-.55.85-1.05.85H3.05c-.5 0-.95-.35-1.05-.85L2 5z"/>
</svg>`

// Markdown document — folded page with a deliberately drawn M. The
// center point sits lower than the two shoulders, so it reads as M
// rather than the inverted W-like mark used by the previous version.
export const ICON_FILE_MD = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2h5L13 6.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2v4.5H13"/>
  <path d="M5.75 11.25V8.5L8 10.5l2.25-2v2.75"/>
</svg>`

// Chevron — centered on the shared 16px grid. The file tree rotates it
// 90 degrees for the expanded state.
export const ICON_CHEVRON = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M6 4l4 4-4 4"/>
</svg>`

export const ICON_FILE_PLUS = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2.5h5L12 6V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2.5v3.5H12"/>
  <path d="M7.75 8v4M5.75 10h4"/>
</svg>`

export const ICON_FOLDER_PLUS = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3L8 4.5h4.5A1.5 1.5 0 0 1 14 6v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>
  <path d="M8 7.75v4M6 9.75h4"/>
</svg>`

// Pencil — simple, single triangular tip plus diagonal body. Stays
// light so the 14px render doesn't show extra internal lines that
// wouldn't survive the stroke at small sizes.
export const ICON_RENAME = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M11.5 2.5l2 2-7 7-3 .5.5-3z"/>
  <path d="M10 4l2 2"/>
</svg>`

// Trash — lid + bucket + two interior verticals. Vertical strokes are
// short (1px below the lid) so the body doesn't get crowded at 14px.
export const ICON_DELETE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 4h10"/>
  <path d="M5.5 4V2.75h5V4"/>
  <path d="M4.5 4l.5 8.5h6L11.5 4"/>
  <path d="M6.75 7v3.5"/>
  <path d="M9.25 7v3.5"/>
</svg>`

// Archive box — lid + bucket body + horizontal handle. Used for the
// Archive note action in the context menu.
export const ICON_ARCHIVE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2.5 3h11v3h-11z"/>
  <path d="M3.5 6v7h9V6"/>
  <path d="M6.5 8.5h3"/>
</svg>`

// "Document properties" — file outline with three lines inside.
// Matches the file-tree file icon family and reads as "metadata list".
export const ICON_PROPERTIES = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2.5h5L12 6V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2.5v3.5H12"/>
  <path d="M5 8.5h6"/>
  <path d="M5 11h6"/>
</svg>`

// Search — magnifier. Visual centroid at (8, 8).
export const ICON_SEARCH = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="7" cy="7" r="4.25"/>
  <path d="M10.25 10.25L13.5 13.5"/>
</svg>`

// Scope chip glyphs. Each maps to a vault root.
//   inbox       — capture bucket: tray with a downward arrow into it
//   literature  — long-form reference: open book
//   archive     — archived note: archive box (same family as ICON_ARCHIVE)
export const ICON_SCOPE_INBOX = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 9.5l1.5-5.5h9L14 9.5"/>
  <path d="M2 9.5h3l1 1.5h4l1-1.5h3v3.5c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V9.5z"/>
  <path d="M8 2v5M5.5 4.5L8 7l2.5-2.5"/>
</svg>`

export const ICON_SCOPE_LITERATURE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 3.5C2 2.95 2.45 2.5 3 2.5h3.5c.83 0 1.5.67 1.5 1.5v8.5c0-.83-.67-1.5-1.5-1.5H3c-.55 0-1-.45-1-1V3.5z"/>
  <path d="M14 3.5C14 2.95 13.55 2.5 13 2.5H9.5C8.67 2.5 8 3.17 8 4v8.5c0-.83.67-1.5 1.5-1.5H13c.55 0 1-.45 1-1V3.5z"/>
  <path d="M8 4v8.5"/>
</svg>`

// Archive box family — same lid + body + handle language as
// ICON_ARCHIVE, with a small gap between lid and body so the two
// icons stay related but visually distinct.
export const ICON_SCOPE_ARCHIVE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <rect x="2.5" y="2.5" width="11" height="3" rx="1"/>
  <path d="M3.5 6.5h9v6.5h-9z"/>
  <path d="M6.5 9h3"/>
</svg>`

// Tag — outline + small hole. The hole is the only fill element, kept
// tiny so it reads as "this is where the string goes" without adding
// visual weight.
export const ICON_TAG = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2.5 2.5h5l6 6-6 6-5-5V2.5z"/>
  <circle cx="5.25" cy="5.25" r="0.7" fill="currentColor" stroke="none"/>
</svg>`

// AI sparkle — primary 4-point star plus a small accent star. Both
// are pure outline (no fill, no decorative dot). Used only inside the
// AI panel for AI-scoped UI; the NavBar right-rail toggle uses
// ICON_PANEL_RIGHT_* instead.
export const ICON_AI = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M8 1.5l1.7 5L14.5 8l-4.8 1.5L8 14.5l-1.7-5L1.5 8l4.8-1.5z"/>
  <path d="M13.5 1.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z"/>
</svg>`

// Right panel — open. Rect + vertical divider so it reads as
// "main area | side panel". Used when the right rail is visible.
export const ICON_PANEL_RIGHT_OPEN = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <rect x="2" y="3" width="12" height="10" rx="1.5"/>
  <line x1="9" y1="3" x2="9" y2="13"/>
</svg>`

// Right panel — closed. Same rect + divider as the open variant, but
// with a small right-pointing chevron in the right column hinting at
// "click to expand the rail". Keeps the two states visually related.
export const ICON_PANEL_RIGHT_CLOSE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <rect x="2" y="3" width="12" height="10" rx="1.5"/>
  <line x1="9" y1="3" x2="9" y2="13"/>
  <path d="M11.25 6.5l1.25 1.5-1.25 1.5"/>
</svg>`

// History — counter-clockwise circle with a return arrow at the gap
// and clock hands inside. Lucide-style line history, kept on the
// 16×16 grid so it lines up with the rest of the icon family.
export const ICON_HISTORY = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2.5 8a5.5 5.5 0 1 0 1.65-3.9L2.5 5.5"/>
  <path d="M2.5 2.5v3h3"/>
  <path d="M8 5v3l2 1"/>
</svg>`

// New chat — message bubble with a plus inside. Reads as "start a
// new conversation" without confusion with "add generic item".
export const ICON_NEW_CHAT = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M14 9.5a1.5 1.5 0 0 1-1.5 1.5H4.5L2 13.5V3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5z"/>
  <path d="M5.5 6.5h5"/>
  <path d="M8 4v5"/>
</svg>`

// Link — two interlocked chain rings at 45°. Pure outline, matches
// the 1.5px stroke weight of the rest of the icon family.
export const ICON_LINKS = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M6.67 9.33a2.67 2.67 0 0 0 3.77 0l2-2a2.67 2.67 0 0 0-3.77-3.77l-.85.85"/>
  <path d="M9.33 6.67a2.67 2.67 0 0 0-3.77 0l-2 2a2.67 2.67 0 0 0 3.77 3.77l.85-.85"/>
</svg>`

// TOC — vertical stack of three line pairs, the universal "outline"
// glyph. Bullet column on the left, content lines on the right.
export const ICON_TOC = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <line x1="3" y1="4"  x2="5.5" y2="4"  />
  <line x1="3" y1="8"  x2="5.5" y2="8"  />
  <line x1="3" y1="12" x2="5.5" y2="12" />
  <line x1="7" y1="4"  x2="13"  y2="4"  />
  <line x1="7" y1="8"  x2="13"  y2="8"  />
  <line x1="7" y1="12" x2="13"  y2="12" />
</svg>`

// Eye — open eye (lens + iris). Used for the NavBar preview toggle.
export const ICON_EYE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M1.5 8s2-4.5 6.5-4.5S14.5 8 14.5 8s-2 4.5-6.5 4.5S1.5 8 1.5 8z"/>
  <circle cx="8" cy="8" r="2"/>
</svg>`

// Reading mode — an open book with gently curved page edges. Both
// pages meet at the spine without crossing below it, avoiding the
// bookmark-like point produced by the previous icon at 14px.
export const ICON_READ = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 3.5c2-.5 4-.2 6 1.25V13c-2-1.45-4-1.75-6-1.25z"/>
  <path d="M14 3.5c-2-.5 4-.2-6 1.25V13c2-1.45 4-1.75 6-1.25z"/>
</svg>`

// File-operation icons used by AI tool cards. Each maps 1:1 to a tool
// name returned by the AI executor. Tuned for the small 14px display
// inside the AI panel header (fewer strokes than the general ICON_*
// family would use at the same size).

// Read file — page outline with a corner, second path reinforces the
// bottom edge so it reads as a "page being opened" rather than a card.
export const ICON_READ_FILE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 3h10l2 2v8H2z"/>
  <path d="M2 3v10h12"/>
</svg>`

// List files — three horizontal rules at equal spacing. The universal
// "list" mark, kept distinct from ICON_TOC by uniform weight (TOC
// pairs bullets with longer content lines).
export const ICON_LIST_FILES = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 4h12M2 8h12M2 12h12"/>
</svg>`

// Create file — document outline with a plus inside. Smaller corner
// fold than ICON_FILE_PLUS so it stays crisp at 14px.
export const ICON_CREATE_FILE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 2h7l3 3v9H3z"/>
  <path d="M8 7v4M6 9h4"/>
</svg>`

// Write file — pencil tip without the body. Reads as "writing into"
// rather than "rename" (which uses the full pencil with eraser).
export const ICON_WRITE_FILE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M11 2l3 3-8 8H3v-3z"/>
</svg>`

// Patch file — two nodes connected by a horizontal stroke, with two
// short diagonal lines suggesting a transformation. Reads as
// "edit-in-place" without committing to a single metaphor.
export const ICON_PATCH_FILE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="6" cy="6" r="2"/>
  <circle cx="10" cy="10" r="2"/>
  <path d="M7 8l2 0M7 8l-1 4M9 8l1-4"/>
</svg>`

// Delete file — simplified trash (lid + bucket only, no interior
// verticals). Reads faster than ICON_DELETE at 14px in the AI panel.
export const ICON_DELETE_FILE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 4h10M5 4V2h6v2M5 4l1 10h4l1-10"/>
</svg>`

// Rename file — a rotated card with a diagonal stroke. Reads as
// "relabel" rather than "edit" (which would be ICON_RENAME).
export const ICON_RENAME_FILE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 12V8l8-8 4 4-8 8z"/>
  <path d="M6 6l4 4"/>
</svg>`

// --- AI concept vocabulary -------------------------------------------------
//
// Five glyphs that replace the over-used sparkle inside the AI panel.
// They form a vocabulary, not a family: each one uses a distinct
// geometric language so the user can scan a row of tool indicators
// and tell which is which without reading the label.
//
// These are intentionally NOT variants of the document / folder /
// trash bases — they live in their own visual lane.

// ICON_AI_CONTEXT — two stacked cards (offset rectangles, each with a
// short content line). Reads as "set of references the AI sees".
// Distinct from ICON_FILE_MD by being two cards, not one folded page.
export const ICON_AI_CONTEXT = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <rect x="2.5" y="2.5" width="9" height="9" rx="1"/>
  <path d="M4.75 5.5h4.5M4.75 8h3"/>
  <rect x="4.5" y="4.5" width="9" height="9" rx="1"/>
  <path d="M6.75 7.5h4.5M6.75 10h3"/>
</svg>`

// ICON_AI_MEMORY — three filled dots in a vertical column. Pure fill
// (no outline) so it reads as solid-state storage, distinct from the
// stroke-only document/folder family. Each dot reads as one stored
// entry; the column implies a stack.
export const ICON_AI_MEMORY = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
  <circle cx="8" cy="3.5" r="1.25"/>
  <circle cx="8" cy="8" r="1.25"/>
  <circle cx="8" cy="12.5" r="1.25"/>
</svg>`

// ICON_AI_REASONING — two outline circles connected by a horizontal
// stroke that ends in a small chevron, suggesting a directed edge
// between two reasoning steps. Reads as "A then B". Distinct from
// the knowledge graph node language by having exactly two nodes
// and an arrow, not a cluster.
export const ICON_AI_REASONING = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="4" cy="8" r="1.5"/>
  <circle cx="12" cy="8" r="1.5"/>
  <path d="M5.5 8h4"/>
  <path d="M9.5 6.5l1 1.5-1 1.5"/>
</svg>`

// ICON_AI_PROMPT — a chevron and a short underscore below it, the
// universal terminal-prompt glyph (> _). Reads as "user input".
// Pure stroke, no fills; deliberately similar to ICON_CHEVRON's
// stroke language but with the trailing underscore to disambiguate.
export const ICON_AI_PROMPT = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 4l4 4-4 4"/>
  <path d="M9 12h4"/>
</svg>`

// ICON_AI_CONVERSATION — two overlapping rounded rectangles, each
// with a small tail at the bottom, suggesting two speakers trading
// turns. Distinct from ICON_NEW_CHAT (single bubble with plus) by
// being two bubbles with no plus sign.
export const ICON_AI_CONVERSATION = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h6A1.5 1.5 0 0 1 11 4.5v3.75A1.5 1.5 0 0 1 9.5 9.75H6l-2 1.75V9.75H3.5A1.5 1.5 0 0 1 2 8.25z"/>
  <path d="M7 7.75A1.5 1.5 0 0 1 8.5 6.25h4A1.5 1.5 0 0 1 14 7.75v3.75A1.5 1.5 0 0 1 12.5 13H12l-2 1.75V13H8.5A1.5 1.5 0 0 1 7 11.5z"/>
</svg>`

// --- Knowledge relationship vocabulary --------------------------------------
//
// Seven glyphs that name the relationships between notes. Where the
// AI vocabulary replaces sparkle inside the AI panel, these replace
// ad-hoc labels in the citation, backlinks, and graph surfaces.
//
// Each one uses a distinct geometric language so the user can scan
// a row of relationship indicators and tell which is which without
// reading the label. They are NOT variants of each other; the
// metaphor for each is chosen for distinctness first, prettiness
// second.

// ICON_KNOWLEDGE_BACKLINK — a node on the right with an arrow
// pointing into it from the left. Reads as "another note links to
// this one". Pairs directionally with ICON_KNOWLEDGE_OUTGOING.
export const ICON_KNOWLEDGE_BACKLINK = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="12" cy="8" r="2"/>
  <path d="M2 8h7"/>
  <path d="M4.5 6L2 8l2.5 2"/>
</svg>`

// ICON_KNOWLEDGE_OUTGOING — the same node + arrow composition but
// mirrored: node on the left, arrow pointing away to the right.
// Reads as "this note links to another".
export const ICON_KNOWLEDGE_OUTGOING = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="4" cy="8" r="2"/>
  <path d="M7 8h7"/>
  <path d="M11.5 6L14 8l-2.5 2"/>
</svg>`

// ICON_KNOWLEDGE_REFERENCE — an inline anchor bracket on the left
// with a single short content line. Reads as "[n] inline reference",
// the marker you would find in body text pointing at a citation.
// Distinct from ICON_KNOWLEDGE_CITATION by being a single bracket
// (compact marker) rather than a vertical bar with multiple lines
// (block quotation).
export const ICON_KNOWLEDGE_REFERENCE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 4v8"/>
  <path d="M3 4h2M3 12h2"/>
  <path d="M8 8h6"/>
</svg>`

// ICON_KNOWLEDGE_CITATION — a left vertical bar plus three content
// lines of decreasing length, the universal block-quote glyph.
// Reads as "this is a cited passage". Pairs with ICON_KNOWLEDGE_REFERENCE:
// reference points at the citation.
export const ICON_KNOWLEDGE_CITATION = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 3v10"/>
  <path d="M6 6h8M6 8.5h6M6 11h4"/>
</svg>`

// ICON_KNOWLEDGE_GRAPH — three outline nodes connected by edges in
// a triangle. Non-directional cluster, deliberately distinct from
// ICON_AI_REASONING (which is two nodes + an arrow, directional).
export const ICON_KNOWLEDGE_GRAPH = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="4" cy="4" r="1.25"/>
  <circle cx="12" cy="4" r="1.25"/>
  <circle cx="8" cy="11.5" r="1.25"/>
  <path d="M5 5l2.5 5M11 5L8.5 10"/>
</svg>`

// ICON_KNOWLEDGE_COLLECTION — three small rounded squares in a row,
// like pills or thumbnails. Reads as "a group of items, side by side".
// Distinct from ICON_FOLDER (a single container) by being the items
// themselves, not the container.
export const ICON_KNOWLEDGE_COLLECTION = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <rect x="2" y="6" width="3" height="4" rx="1"/>
  <rect x="6.5" y="6" width="3" height="4" rx="1"/>
  <rect x="11" y="6" width="3" height="4" rx="1"/>
</svg>`

// ICON_KNOWLEDGE_MAP — three outline circles in a triangle with a
// single connector between them. Reads as "waypoints, small graph".
// Distinct from ICON_KNOWLEDGE_GRAPH (3 nodes + 2 edges, fully
// connected) by being 3 nodes + 1 edge (a path, not a cluster).
export const ICON_KNOWLEDGE_MAP = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="4" cy="8" r="1.25"/>
  <circle cx="8" cy="4" r="1.25"/>
  <circle cx="12" cy="8" r="1.25"/>
  <path d="M5 8h6"/>
</svg>`

// --- Status vocabulary ------------------------------------------------------
//
// Six glyphs covering the canonical product states. The spec defines
// them as shape-coded first, color-coded second — see Status Base in
// docs/design/icon-system.md. The icons themselves use currentColor
// so consumers pair them with --status-{success,warning,error,...}
// CSS variables. SUCCESS and MODIFIED are filled (listed in
// FILLED_ICONS); the rest stay on the outline default.

// ICON_STATUS_SUCCESS — a single large filled circle. Reads as
// "completed / passed". Pair with --status-success.
export const ICON_STATUS_SUCCESS = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
  <circle cx="8" cy="8" r="3.25"/>
</svg>`

// ICON_STATUS_WARNING — outline triangle with apex up. The internal
// mark (exclamation dot) is omitted at 14px to keep the silhouette
// crisp; the consumer pairs the icon with surrounding text or a
// tooltip for the message. Pair with --status-warning.
export const ICON_STATUS_WARNING = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M8 3l5.5 9.5h-11z"/>
</svg>`

// ICON_STATUS_ERROR — outline diamond (square rotated 45°). Reads as
// "stop / failed". Pair with --status-error.
export const ICON_STATUS_ERROR = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M8 2.5L13.5 8L8 13.5L2.5 8z"/>
</svg>`

// ICON_STATUS_LOADING — a 3/4 outline arc, open at the lower-right.
// Pure stroke so consumers can rotate the SVG with CSS for the
// spinner animation. Pair with --status-neutral.
export const ICON_STATUS_LOADING = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M13 8a5 5 0 1 1-2.5-4.33"/>
</svg>`

// ICON_STATUS_OFFLINE — an X cross. Two diagonal strokes, the
// universal "disconnected" mark. Pair with --status-neutral.
export const ICON_STATUS_OFFLINE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M4 4l8 8M12 4l-8 8"/>
</svg>`

// ICON_STATUS_MODIFIED — a small filled dot. Geometrically smaller
// than ICON_STATUS_SUCCESS so the two remain distinguishable by
// shape even when currentColor is identical (e.g. a monochrome
// printout). Pair with --status-modified.
export const ICON_STATUS_MODIFIED = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
  <circle cx="8" cy="8" r="1.5"/>
</svg>`

// --- File-type vocabulary ---------------------------------------------------
//
// Seven document variants for the file tree. All share the Document
// Base (folded corner) and only the inner content mark changes, so a
// row of mixed files reads as "all documents, different contents".
//
// Existing ICON_FILE_MD and ICON_FILE_PROPERTIES stay as-is — they're
// the canonical markdown and metadata icons. The seven here cover the
// non-markdown attachments and binary files that can appear in a
// vault's content directory.

// ICON_FILE_IMAGE — document outline + small mountain silhouette +
// filled dot sun. Reads as "image attachment".
export const ICON_FILE_IMAGE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2h5L13 6.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2v4.5H13"/>
  <path d="M4.5 11.5l2-2.25 1.75 2 1.75-2.25 2 2.5"/>
  <circle cx="6" cy="6" r="0.75" fill="currentColor" stroke="none"/>
</svg>`

// ICON_FILE_PDF — document outline + three horizontal content lines
// (descending length, the "list" pattern) + a filled corner dot that
// tags it as a binary/external format. The dot is what separates this
// from ICON_FILE_PROPERTIES — the reader learns "this row has a tag".
export const ICON_FILE_PDF = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2h5L13 6.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2v4.5H13"/>
  <path d="M5 9h6M5 11h4"/>
  <circle cx="11" cy="6.5" r="0.75" fill="currentColor" stroke="none"/>
</svg>`

// ICON_FILE_VIDEO — document outline + a right-pointing play
// triangle. The triangle is centered in the document body so the
// silhouette is unambiguous at 14px.
export const ICON_FILE_VIDEO = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2h5L13 6.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2v4.5H13"/>
  <path d="M6.75 8.25v3.5l3-1.75z"/>
</svg>`

// ICON_FILE_AUDIO — document outline + three vertical bars of varying
// height joined by a single horizontal stroke. The "waveform"
// silhouette: shorter than a real waveform, but enough for a 14px
// reader to associate with audio.
export const ICON_FILE_AUDIO = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2h5L13 6.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2v4.5H13"/>
  <path d="M5 10.5v-2M8 11v-3M11 10.5v-2"/>
  <path d="M4.5 9.5h7"/>
</svg>`

// ICON_FILE_CODE — document outline + left and right angle brackets.
// The classic "<…>" code-file mark, condensed to two strokes that
// bracket the empty middle of the document body.
export const ICON_FILE_CODE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2h5L13 6.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2v4.5H13"/>
  <path d="M6.5 8.5L5 10l1.5 1.5"/>
  <path d="M9.5 8.5L11 10l-1.5 1.5"/>
</svg>`

// ICON_FILE_ATTACHMENT — document outline + a paperclip-style curve
// sweeping diagonally inside the body. A real paperclip is too dense
// for 14px; this is the silhouette: one curved stroke that reads as
// "something is clipped to this file".
export const ICON_FILE_ATTACHMENT = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2h5L13 6.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2v4.5H13"/>
  <path d="M5 11.5l4-4a1.25 1.25 0 0 1 1.75 1.75l-3 3a1 1 0 0 1-1.4-1.4l2.5-2.5"/>
</svg>`

// ICON_FILE_DRAFT — document outline + a small four-point star inside
// the body. The star is the universal "marked / to-do" mark; combined
// with the document outline it reads as "a draft (marked-up) file".
export const ICON_FILE_DRAFT = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2h5L13 6.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2v4.5H13"/>
  <path d="M8 9v2M7 10h2M7.7 8.3l1.4 1.4M8.3 8.3l-1.4 1.4"/>
</svg>`

// --- Surface-display icons (NavBar + ActivityBar) --------------------------
//
// These seven icons live in toolbar slots that need a larger visual
// weight than the inline 14px functional icons — NavBar buttons are
// 16-18px on a 36px button, ActivityBar buttons are 22px on a 48px
// rail. To preserve optical balance with the button chrome, they
// use the 24x24 canvas + adjusted stroke weight convention from the
// upstream lucide-tabler line icons (display sizes 16 / 18 / 22 px,
// stroke-width 2 / 1.8 respectively).
//
// They follow every HARD rule of the spec (no <text>, no color
// literals, no root class/style, no 1024-style viewBox). They
// intentionally diverge from the shared grid on viewBox / width /
// height / stroke-width — those four attributes are SOFT rules in
// the lint, and the linter exempts this file from reporting them
// (icons.test.ts is the authoritative check for icons.ts exports).
//
// Future work: redraw each at the 16x16 grid + 1.5 stroke so the
// toolbar slot can render at the 14px default. Until then, these are
// the canonical surface-display set.

// ICON_NAV_SEARCH — magnifier on a 24x24 canvas, displayed at 16px.
// Pair with the nav search button.
export const ICON_NAV_SEARCH = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="11" cy="11" r="7"/>
  <line x1="20" y1="20" x2="16.5" y2="16.5"/>
</svg>`

// ICON_NAV_THEME_LIGHT — sun glyph shown when the current theme is
// dark (click to switch to light).
export const ICON_NAV_THEME_LIGHT = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="4"/>
  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
</svg>`

// ICON_NAV_THEME_DARK — crescent shown when the current theme is
// light (click to switch to dark).
export const ICON_NAV_THEME_DARK = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
</svg>`

// ICON_AB_FILES — activity-bar button that opens the file panel.
// Visually a folder-with-tab; conceptually the same as ICON_FOLDER
// (which is for tree-row use) but drawn on the surface canvas.
export const ICON_AB_FILES = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
</svg>`

// ICON_AB_TAGS — activity-bar button that opens the tag panel.
export const ICON_AB_TAGS = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
  <line x1="7" y1="7" x2="7.01" y2="7"/>
</svg>`

// ICON_AB_GIT_HISTORY — three commit dots connected by a vertical
// line and a curved branch. Distinct from ICON_HISTORY (which is the
// Lucide-style clock + return arrow) by being a graph of commits
// instead of a single time event.
export const ICON_AB_GIT_HISTORY = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="6" cy="5" r="1.6" fill="currentColor" stroke="none"/>
  <circle cx="6" cy="19" r="1.6" fill="currentColor" stroke="none"/>
  <circle cx="17" cy="12" r="1.6" fill="currentColor" stroke="none"/>
  <line x1="6" y1="6.5" x2="6" y2="17.5"/>
  <path d="M6 12 C 10 12, 12 12, 15.4 12"/>
</svg>`

// ICON_AB_SETTINGS — activity-bar button that opens the settings modal.
// The classic gear silhouette.
export const ICON_AB_SETTINGS = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.98 2.98l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.66V21a2.1 2.1 0 0 1-4.2 0v-.06A1.8 1.8 0 0 0 8.4 19.3a1.8 1.8 0 0 0-1.98.36l-.04.04A2.1 2.1 0 0 1 3.4 16.72l.04-.04A1.8 1.8 0 0 0 3.8 14.7a1.8 1.8 0 0 0-1.66-1.1H2a2.1 2.1 0 0 1 0-4.2h.06A1.8 1.8 0 0 0 3.7 8.3a1.8 1.8 0 0 0-.36-1.98l-.04-.04A2.1 2.1 0 0 1 6.28 3.3l.04.04A1.8 1.8 0 0 0 8.3 3.7h.1A1.8 1.8 0 0 0 9.5 2.06V2a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.1 1.64 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.1 2.1 0 0 1 2.98 2.98l-.04.04a1.8 1.8 0 0 0-.36 1.98v.1a1.8 1.8 0 0 0 1.66 1.1H21a2.1 2.1 0 0 1 0 4.2h-.06A1.8 1.8 0 0 0 19.4 15z"/>
</svg>`

// --- Editor state vocabulary -----------------------------------------------
//
// Seven icons covering view-mode toggles and editor chrome. These
// are vocabulary ahead of feature: several surface controls
// (Split, Zen, Wrap, Line Number, Minimap, Pin, Floating) are
// aspirational today, but having the icons ready in the central
// module means the first time a feature lands it ships with a
// visually consistent glyph. Each uses a distinct geometric
// language so a row of editor controls stays readable.

// ICON_EDITOR_SPLIT — two side-by-side rectangles representing the
// split-pane edit + preview layout. The dividing gutter is the
// negative space between them.
export const ICON_EDITOR_SPLIT = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <rect x="2" y="3" width="5" height="10" rx="0.5"/>
  <rect x="9" y="3" width="5" height="10" rx="0.5"/>
</svg>`

// ICON_EDITOR_ZEN — four corner brackets expanding outward, the
// "distraction-free mode" mark. Read as "expand to all four
// corners" / "full attention".
export const ICON_EDITOR_ZEN = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 6V3h3"/>
  <path d="M10 3h3v3"/>
  <path d="M13 10v3h-3"/>
  <path d="M6 13H3v-3"/>
</svg>`

// ICON_EDITOR_WRAP — a horizontal line that dips into a U-curve
// before continuing. Reads as "soft-wrap: line returns to margin".
export const ICON_EDITOR_WRAP = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 5h10"/>
  <path d="M5 5v2a3 3 0 0 0 6 0V5"/>
</svg>`

// ICON_EDITOR_LINE_NUMBER — left margin line + two short ticks +
// a content line. Reads as "lines with numbers in the gutter".
export const ICON_EDITOR_LINE_NUMBER = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 3v10"/>
  <path d="M5.5 6.5h1M5.5 9.5h1"/>
  <path d="M8.5 6.5h5M8.5 9.5h3.5"/>
</svg>`

// ICON_EDITOR_MINIMAP — a small filled rectangle inside an outlined
// window, with a horizontal stroke bisecting it as the scroll
// indicator. The fill reads as "rendered preview".
export const ICON_EDITOR_MINIMAP = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <rect x="2" y="3" width="12" height="10" rx="0.5"/>
  <rect x="4" y="5" width="8" height="6" rx="0.25" fill="currentColor" stroke="none"/>
  <path d="M4 8.5h8"/>
</svg>`

// ICON_EDITOR_PIN — a small filled circle on top of a vertical
// line, the "pushpin" silhouette. Reads as "sticky / pinned".
export const ICON_EDITOR_PIN = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <circle cx="8" cy="4" r="2" fill="currentColor" stroke="none"/>
  <path d="M8 6v8"/>
</svg>`

// ICON_EDITOR_FLOATING — two rounded rectangles overlapping
// diagonally. The front rect's outline is partial so the back
// rect reads through it; reads as "popped out / detached".
export const ICON_EDITOR_FLOATING = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M10.5 2.5h3a.5.5 0 0 1 .5.5v3"/>
  <rect x="2" y="6" width="8" height="8" rx="0.5"/>
  <path d="M2.5 10.5v3a.5.5 0 0 0 .5.5h3"/>
</svg>`

// --- Context menu vocabulary -----------------------------------------------

// ICON_MOVE — a horizontal arrow pointing right. Reads as "this
// item moves (or is sent) somewhere else". Pairs with ICON_COPY
// (which keeps a reference here).
export const ICON_MOVE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3 8h10"/>
  <path d="M10 5l3 3-3 3"/>
</svg>`

// ICON_COPY — two stacked rounded rectangles, the back one offset
// down-right. Reads as "two of these things". Distinct from
// ICON_KNOWLEDGE_COLLECTION (3 in a row) and ICON_FILE_IMAGE
// (document with content).
export const ICON_COPY = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <rect x="2" y="2" width="9" height="9" rx="0.5"/>
  <rect x="5" y="5" width="9" height="9" rx="0.5"/>
</svg>`

// ICON_DUPLICATE — document outline + a filled dot in the lower
// right corner, the "plus one" indicator. Reads as "this document
// plus a sibling". Distinct from ICON_FILE_PDF (which uses a
// smaller corner tag dot) by the dot's larger radius and the
// empty body (PDF has content lines; DUPLICATE does not).
export const ICON_DUPLICATE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M3.5 2h5L13 6.5V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/>
  <path d="M8.5 2v4.5H13"/>
  <circle cx="11" cy="11" r="1.75" fill="currentColor" stroke="none"/>
</svg>`
