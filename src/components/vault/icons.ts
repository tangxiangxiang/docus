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

// "New file" — 16×16 doc glyph with a small accent "+" badge in the bottom-right.
export const ICON_NEW_FILE = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3.75 2h5.5L13 5.75V12.5c0 .83-.67 1.5-1.5 1.5h-7.75C2.92 14 2.25 13.33 2.25 12.5V3.5C2.25 2.67 2.92 2 3.75 2z"/>
  <path d="M9.25 2v3.75H13"/>
  <circle cx="11.75" cy="11.75" r="3" fill="var(--vs-bg-2, #1e1e1e)" stroke="currentColor" stroke-width="1.2"/>
  <path d="M11.75 10.25v3M10.25 11.75h3"/>
</svg>`

// "New folder" — same doc/folder body with a "+" badge in the bottom-right.
export const ICON_NEW_FOLDER = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2.5 4.5C2.5 3.67 3.17 3 4 3h3l1.5 1.5h4.5c.83 0 1.5.67 1.5 1.5v6.5c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5V4.5z"/>
  <circle cx="11.75" cy="11.75" r="3" fill="var(--vs-bg-2, #1e1e1e)" stroke="currentColor" stroke-width="1.2"/>
  <path d="M11.75 10.25v3M10.25 11.75h3"/>
</svg>`
