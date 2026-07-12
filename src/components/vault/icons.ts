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

export const ICON_FILE_PLUS = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5h6l3 3V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M9 2.5v3h3"/><path d="M7 8v4M5 10h4"/></svg>`

export const ICON_FOLDER_PLUS = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3L8 4.5h4.5A1.5 1.5 0 0 1 14 6v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M8 7.5v4M6 9.5h4"/></svg>`

export const ICON_RENAME = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5l.5-3L10.8 2.2a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L6.5 12.5l-3 .5z"/><path d="M9.5 3.5l3 3"/></svg>`

export const ICON_DELETE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9h6.8l.6-9M6.5 6.5v4M9.5 6.5v4"/></svg>`

export const ICON_ARCHIVE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3h11v3h-11zM3.5 6v7h9V6M6.5 8.5h3"/></svg>`

export const ICON_PROPERTIES = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5h7l3 3V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M10 2.5v3h3M5 8h6M5 10.5h6"/></svg>`

// "Search" — magnifier. 14×14 line art, matches the scope/file-tree icons.
// Used as the prefix glyph in the TagPanel filter input; the host turns
// it accent-blue on focus-within to confirm the search context.
export const ICON_SEARCH = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="7" cy="7" r="4.25"/>
  <path d="M10.25 10.25L13.5 13.5"/>
</svg>`

// Scope chip glyphs. Each is 14×14 line art, matching the file-tree
// row icons. The three map to the vault roots:
//   inbox       — capture bucket: an inbox tray with a downward arrow
//   literature  — long-form reference: an open book
//   archive     — archived note: a stacked card
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

export const ICON_SCOPE_ARCHIVE = `
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
// header (the panel itself) and in the NavBar, where it now serves
// only as a decorative role for AI-scoped UI; the right-rail toggle
// in the NavBar uses ICON_PANEL_RIGHT_* below instead, since that
// button represents the right rail (AI / TOC / Links), not AI.
export const ICON_AI = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 1.5l1.4 4.1L13.5 7l-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4z"/>
  <circle cx="13" cy="13" r="0.6" fill="currentColor" stroke="none"/>
</svg>`

// "Right panel — open". 14×14 line art matching the file-tree /
// scope-chip icon set. The NavBar right-rail toggle uses this when
// the rail is visible: the rectangle with a vertical divider reads
// as "main area | right panel", conveying "click to collapse the
// rail". Modeled on Lucide's PanelRight so it sits in the same icon
// family as VS Code's secondary-sidebar toggle.
export const ICON_PANEL_RIGHT_OPEN = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="3" width="12" height="10" rx="1.5"></rect>
  <line x1="9" y1="3" x2="9" y2="13"></line>
</svg>`

// "Right panel — closed". Same rectangle as the open variant but
// without the vertical divider, so the right panel reads as folded
// back into the main area. Pairs with ICON_PANEL_RIGHT_OPEN so the
// NavBar toggle reflects the rail's current visibility.
export const ICON_PANEL_RIGHT_CLOSE = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="3" width="12" height="10" rx="1.5"></rect>
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
<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 1024 1024" fill="currentColor">
  <path d="M511.488 0C228.864 0 0 229.376 0 512s228.864 512 511.488 512C794.624 1024 1024 794.624 1024 512s-229.376-512-512.512-512z m21.76 556.416V219.52H438.912v392.32h1.472l243.84 140.8 47.296-81.728-198.144-114.432zM512 921.6A409.472 409.472 0 0 1 102.4 512c0-226.304 183.296-409.6 409.6-409.6 226.304 0 409.6 183.296 409.6 409.6 0 226.304-183.296 409.6-409.6 409.6z"/>
</svg>`

// "New chat" — plus in a square. 14×14 line art. Creates a fresh
// session and switches to it.
export const ICON_NEW_CHAT = `
<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 1024 1024" fill="currentColor">
  <path d="M576 64H448v384H64v128h384v384h128V576h384V448H576z"/>
</svg>`

// "Link" — two interlocked rings. 14×14 line art, visually
// centered in the 16×16 viewBox (centroid at (8, 8)). Used for
// the Links activity-bar entry. Kept consistent with the
// ICON_HISTORY / ICON_NEW_CHAT visual weight (1.5px stroke).
export const ICON_LINKS = `
<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 1024 1024" fill="currentColor">
  <path d="M593.944 715.648a10.688 10.688 0 0 0-14.976 0L424.216 870.4c-71.68 71.68-192.576 79.232-271.68 0-79.232-79.232-71.616-200 0-271.616l154.752-154.752a10.688 10.688 0 0 0 0-15.04l-52.992-52.992a10.688 10.688 0 0 0-15.04 0L84.504 530.688a287.872 287.872 0 0 0 0 407.488 288 288 0 0 0 407.488 0l154.752-154.752a10.688 10.688 0 0 0 0-15.04l-52.736-52.736z m344.384-631.168a288.256 288.256 0 0 1 0 407.616l-154.752 154.752a10.688 10.688 0 0 1-15.04 0l-52.992-52.992a10.688 10.688 0 0 1 0-15.104l154.752-154.688c71.68-71.68 79.232-192.448 0-271.68-79.104-79.232-200-71.68-271.68 0L443.928 307.2a10.688 10.688 0 0 1-15.04 0l-52.864-52.864a10.688 10.688 0 0 1 0-15.04l154.88-154.752a287.872 287.872 0 0 1 407.424 0z m-296.32 240.896l52.672 52.736a10.688 10.688 0 0 1 0 15.04l-301.504 301.44a10.688 10.688 0 0 1-15.04 0l-52.736-52.672a10.688 10.688 0 0 1 0-15.04l301.632-301.504a10.688 10.688 0 0 1 15.04 0z"/>
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
