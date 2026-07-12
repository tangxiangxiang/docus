import { describe, expect, it } from 'vitest'
import * as icons from '../icons'

const exportedIcons = Object.entries(icons)

describe('vault icon system', () => {
  it('keeps every functional icon on the shared 16px line-icon grid', () => {
    expect(exportedIcons.length).toBeGreaterThan(0)

    for (const [name, svg] of exportedIcons) {
      expect(svg, name).toContain('width="14"')
      expect(svg, name).toContain('height="14"')
      expect(svg, name).toContain('viewBox="0 0 16 16"')
      expect(svg, name).toContain('fill="none"')
      expect(svg, name).toContain('stroke="currentColor"')
      expect(svg, name).toContain('stroke-width="1.5"')
      expect(svg, name).toContain('stroke-linecap="round"')
      expect(svg, name).toContain('stroke-linejoin="round"')
    }
  })

  it('does not use font-dependent or large source glyphs', () => {
    for (const [name, svg] of exportedIcons) {
      expect(svg, name).not.toMatch(/<text\b/i)
      expect(svg, name).not.toContain('1024')
    }
  })
})
