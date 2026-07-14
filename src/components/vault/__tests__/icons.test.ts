import { describe, expect, it } from 'vitest'
import * as icons from '../icons'

const exportedIcons = Object.entries(icons)

function rootAttributes(svg: string): Map<string, string> {
  const root = svg.match(/<svg\b([^>]*)>/i)
  if (!root) throw new Error('Missing SVG root')
  return new Map(
    [...root[1].matchAll(/([\w:-]+)="([^"]*)"/g)]
      .map((match) => [match[1], match[2]]),
  )
}

const SHARED_ATTRIBUTES = {
  width: '14',
  height: '14',
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.5',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false',
}

// Filled-glyph exceptions. These icons opt out of the fill="none"
// outline default because their concept is solid-state by design
// (status dots, data points). They keep every other shared attribute
// (size, viewBox, stroke caps/joins, aria).
//
// To add an icon here, declare it in icons.ts with:
//   fill="currentColor" stroke="none"
// and explain the design choice in a comment. Each entry must be a
// deliberate fill, not a workaround for a missing outline version.
const FILLED_ICONS = new Set<string>([
  'ICON_AI_MEMORY',
  'ICON_STATUS_SUCCESS',
  'ICON_STATUS_MODIFIED',
  'ICON_STOP',
])

// Surface-display exceptions. These icons live in toolbar slots
// (NavBar, ActivityBar) that need a larger visual weight than the
// inline 14px default. They keep every HARD rule (no <text>, no
// color literals, no root class/style, no 1024 viewBox) but use a
// 24x24 canvas + display sizes 16-22 + stroke-width 1.8-2.
//
// The lint script skips icons.ts, so these don't pollute the
// repo-wide scan; the test still enforces the hard rules below.
const SURFACE_DISPLAY_ICONS = new Set<string>([
  'ICON_NAV_THEME_LIGHT',
  'ICON_NAV_THEME_DARK',
  'ICON_AB_GIT_HISTORY',
  'ICON_AB_SETTINGS',
])

describe('vault icon system', () => {
  it('keeps every functional icon on the shared 16px line-icon grid', () => {
    expect(exportedIcons.length).toBeGreaterThan(0)

    for (const [name, svg] of exportedIcons) {
      expect(name).toMatch(/^ICON_[A-Z0-9_]+$/)
      const attributes = rootAttributes(svg)
      const filled = FILLED_ICONS.has(name)
      const surface = SURFACE_DISPLAY_ICONS.has(name)
      const expectedFill = filled ? 'currentColor' : 'none'
      const expectedStroke = filled ? 'none' : 'currentColor'

      if (!surface) {
        expect(attributes.get('width'), `${name}: width`).toBe(SHARED_ATTRIBUTES.width)
        expect(attributes.get('height'), `${name}: height`).toBe(SHARED_ATTRIBUTES.height)
        expect(attributes.get('viewBox'), `${name}: viewBox`).toBe(SHARED_ATTRIBUTES.viewBox)
        if (!filled) {
          // Filled glyphs use stroke="none" and have no stroke-width.
          expect(attributes.get('stroke-width'), `${name}: stroke-width`)
            .toBe(SHARED_ATTRIBUTES['stroke-width'])
        }
      } else {
        // Surface-display icons use the 24x24 line-icon canvas with
        // display sizes 16-22. We only assert they declare the
        // expected viewBox prefix so a future redraw to the
        // shared grid can flip the icon back to non-surface mode.
        const viewBox = attributes.get('viewBox') ?? ''
        expect(viewBox, `${name}: viewBox`).toMatch(/^0 0 24 24$/)
      }

      expect(attributes.get('fill'), `${name}: fill`).toBe(expectedFill)
      expect(attributes.get('stroke'), `${name}: stroke`).toBe(expectedStroke)
      expect(attributes.get('aria-hidden'), `${name}: aria-hidden`).toBe(SHARED_ATTRIBUTES['aria-hidden'])
      expect(attributes.get('focusable'), `${name}: focusable`).toBe(SHARED_ATTRIBUTES.focusable)

      expect(svg.match(/<svg\b/gi), name).toHaveLength(1)
      expect(svg.match(/<\/svg>/gi), name).toHaveLength(1)
    }
  })

  it('does not use font-dependent or large source glyphs', () => {
    for (const [name, svg] of exportedIcons) {
      expect(svg, name).not.toMatch(/<text\b/i)
      expect(svg, name).not.toContain('1024')
      expect(svg, name).not.toMatch(/(?:fill|stroke)="(?:#[0-9a-f]{3,8}|rgb|hsl)/i)
      expect(svg, name).not.toMatch(/\b(?:class|style)="/i)
    }
  })
})
