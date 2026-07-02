// Inline SVG icon strings for the file tree. Kept as raw strings (not Vue components)
// so they can be inlined into existing v-html bindings without per-icon import cost.
// Style: 14×14, stroke-width 1.5, currentColor, matches ActivityBar / NavBar line weight.

export const ICON_FOLDER = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 4.5C2 3.67 2.67 3 3.5 3h3l1.5 1.5h4.5c.83 0 1.5.67 1.5 1.5v6.5c0 .83-.67 1.5-1.5 1.5h-9C2.67 13.5 2 12.83 2 12V4.5z"/>
</svg>`

export const ICON_FOLDER_OPEN = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 4.5C2 3.67 2.67 3 3.5 3h3l1.5 1.5h4.5c.83 0 1.5.67 1.5 1.5H2V4.5z"/>
  <path d="M2 5h12.5l-1.5 7c-.1.5-.55.85-1.05.85H3.05c-.5 0-.95-.35-1.05-.85L2 5z" fill="currentColor" fill-opacity="0.15"/>
</svg>`

export const ICON_FILE_MD = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3.5 2h6L13 5.5V13c0 .83-.67 1.5-1.5 1.5h-8C2.67 14.5 2 13.83 2 13V3.5C2 2.67 2.67 2 3.5 2z"/>
  <path d="M9.5 2v3.5H13"/>
  <text x="5" y="11.5" font-size="3.5" fill="currentColor" stroke="none" font-family="ui-monospace, monospace">M</text>
  <text x="9" y="11.5" font-size="3.5" fill="currentColor" stroke="none" font-family="ui-monospace, monospace">↓</text>
</svg>`

export const ICON_CHEVRON = `
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3.5 2l3 3-3 3"/>
</svg>`

// "Search" — magnifier. 14×14 line art, matches the scope/file-tree icons.
// Used as the prefix glyph in the TagPanel filter input; the host turns
// it accent-blue on focus-within to confirm the search context.
export const ICON_SEARCH = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="7" cy="7" r="4.25"/>
  <path d="M10.25 10.25L13.5 13.5"/>
</svg>`

// Scope chip glyphs. Each is 14×14 line art, matching the file-tree
// row icons. The three map to the Zettelkasten roots:
//   inbox       — capture bucket: an inbox tray with a downward arrow
//   literature  — long-form reference: an open book
//   zettel      — permanent note: a stacked card (the canonical
//                 Zettelkasten card)
export const ICON_SCOPE_INBOX = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 9.5l1.5-5.5h9L14 9.5"/>
  <path d="M2 9.5h3l1 1.5h4l1-1.5h3v3.5c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V9.5z"/>
  <path d="M8 2v5M5.5 4.5L8 7l2.5-2.5"/>
</svg>`

export const ICON_SCOPE_LITERATURE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 3.5C2 2.95 2.45 2.5 3 2.5h3.5c.83 0 1.5.67 1.5 1.5v8.5c0-.83-.67-1.5-1.5-1.5H3c-.55 0-1-.45-1-1V3.5z"/>
  <path d="M14 3.5C14 2.95 13.55 2.5 13 2.5H9.5C8.67 2.5 8 3.17 8 4v8.5c0-.83.67-1.5 1.5-1.5H13c.55 0 1-.45 1-1V3.5z"/>
  <path d="M8 4v8.5"/>
</svg>`

export const ICON_SCOPE_ZETTEL = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="2" width="9" height="11" rx="1" transform="rotate(-6 3 2)"/>
  <rect x="4" y="3" width="9" height="11" rx="1" transform="rotate(4 4 3)"/>
  <line x1="6" y1="8" x2="10" y2="8.5" transform="rotate(4 4 3)"/>
  <line x1="6" y1="10.5" x2="9" y2="11" transform="rotate(4 4 3)"/>
</svg>`

// Tag glyph (hashtag). 14×14 line art, matches the file-tree row
// icons. Used as the panel-title icon in the TagPanel so the header
// reads the same way as the FileTree's "📁 Explorer" header.
export const ICON_TAG = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2.5 2.5h4l7 7-4 4-7-7z"/>
  <line x1="5" y1="5" x2="7" y2="5"/>
  <line x1="2" y1="8" x2="4" y2="8"/>
</svg>`

// AI sparkle — 4-point star with a small inner dot. 14×14 line art,
// matches the file-tree / scope-chip icon set. Used in the AI panel
// header and the NavBar AI toggle button.
export const ICON_AI = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 1.5l1.4 4.1L13.5 7l-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4z"/>
  <circle cx="13" cy="13" r="0.6" fill="currentColor" stroke="none"/>
</svg>`

// "History" — clock with a counter-clockwise arrow. 14×14 line art,
// matches the ICON_AI weight. Opens the session-history picker.
//
// The visual content is laid out so its y-center sits at 8 within the
// 0 0 16 16 viewBox — i.e. the geometric center of the viewBox — so
// this icon and ICON_NEW_CHAT (a centered plus) sit on the same
// horizontal line when both are centered in the same 22px button.
// Earlier versions had the counter-clockwise arrow polyline reaching
// up to y=1.5 which pushed the visual centroid up by half a unit and
// made the icon look higher than its neighbor.
export const ICON_HISTORY = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 5 A5 5 0 1 1 3 11"/>
  <polyline points="3 3 3 5 5 5"/>
  <polyline points="8 5 8 8 10.5 9.5"/>
</svg>`

// "New chat" — plus in a square. 14×14 line art. Creates a fresh
// session and switches to it.
export const ICON_NEW_CHAT = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="8" y1="3" x2="8" y2="13"/>
  <line x1="3" y1="8" x2="13" y2="8"/>
</svg>`

// "Link" — two interlocked rings. 14×14 line art, visually
// centered in the 16×16 viewBox (centroid at (8, 8)). Used for
// the Links activity-bar entry. Kept consistent with the
// ICON_HISTORY / ICON_NEW_CHAT visual weight (1.5px stroke).
export const ICON_LINKS = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6.5 9.5 A2.5 2.5 0 0 1 6.5 4.5 L8 3 A2.5 2.5 0 0 1 13 3 A2.5 2.5 0 0 1 13 8 L11.5 9.5"/>
  <path d="M9.5 6.5 A2.5 2.5 0 0 1 9.5 11.5 L8 13 A2.5 2.5 0 0 1 3 13 A2.5 2.5 0 0 1 3 8 L4.5 6.5"/>
</svg>`

// "TOC" — a vertical stack of three lines, the universal "outline"
// glyph. 14×14 line art in the same 1.5px stroke as ICON_LINKS so
// the two halves of the right-rail panel read as a matched pair.
export const ICON_TOC = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="3" y1="4"  x2="5.5" y2="4"  />
  <line x1="3" y1="8"  x2="5.5" y2="8"  />
  <line x1="3" y1="12" x2="5.5" y2="12" />
  <line x1="7" y1="4"  x2="13"  y2="4"  />
  <line x1="7" y1="8"  x2="13"  y2="8"  />
  <line x1="7" y1="12" x2="13"  y2="12" />
</svg>`

// "Preview" — an open eye (lens + iris). 14×14 line art in the same
// 1.5px stroke as ICON_TOC / ICON_AI, so it sits visually next to the
// mode-toggle pair without weight mismatch. Used in the NavBar toggle
// that opens the side-by-side preview pane while editing. Active state
// is signaled by CSS (filled background), not by a second icon — the
// same glyph reads as "preview is on" and "preview is off, click to
// turn on" because the button's pressed state is visible.
export const ICON_EYE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1.5 8s2-4.5 6.5-4.5S14.5 8 14.5 8s-2 4.5-6.5 4.5S1.5 8 1.5 8z"/>
  <circle cx="8" cy="8" r="2"/>
</svg>`
