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

describe('vault icon system', () => {
  it('keeps every functional icon on the shared 16px line-icon grid', () => {
    expect(exportedIcons.length).toBeGreaterThan(0)

    for (const [name, svg] of exportedIcons) {
      expect(name).toMatch(/^ICON_[A-Z0-9_]+$/)
      const attributes = rootAttributes(svg)
      for (const [attribute, value] of Object.entries(SHARED_ATTRIBUTES)) {
        expect(attributes.get(attribute), `${name}: ${attribute}`).toBe(value)
      }
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
