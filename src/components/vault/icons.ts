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
  <rect x="2.5" y="2.5" width="11" height="3" rx="0.5"/>
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
  <path d="M14 3.5c-2-.5-4-.2-6 1.25V13c2-1.45 4-1.75 6-1.25z"/>
</svg>`
