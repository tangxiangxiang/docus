// @vitest-environment jsdom
// Tests for useGraphData — the pure projection from the server's
// LinkIndexSnapshot down to force-graph's {nodes, links} shape,
// restricted to the zettel/ subtree.
//
// The composable is fully reactive: it reads `getLinkIndex()` (a
// module-level ShallowRef populated by useLinkIndexSubscription),
// and returns a computed graphData that recomputes on every link
// index change. That means the test only needs to mutate the
// singleton ref to drive it — no fetches, no Vue components.
import { describe, it, expect, beforeEach } from 'vitest'
import { getLinkIndex, __resetLinkIndexForTesting } from '../useLinkIndex'
import { useGraphData } from '../useGraphData'

function setIndex(state: {
  paths: string[]
  outgoing: Record<string, Array<{ target: string; alias?: string; anchor?: string; kind: 'wiki' | 'md' }>>
  titles?: Record<string, string>
}) {
  getLinkIndex().value = {
    paths: new Set(state.paths),
    outgoing: state.outgoing,
    titles: state.titles ?? {},
    lastFetched: 0,
  }
}

beforeEach(() => {
  __resetLinkIndexForTesting()
})

describe('useGraphData — zettel filter', () => {
  it('only includes nodes under zettel/', () => {
    setIndex({
      paths: ['zettel/init', 'zettel/alpha', 'zettel/draft/beta', 'inbox/todo', 'literature/book'],
      outgoing: {},
    })
    const ids = useGraphData().value.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['zettel/alpha', 'zettel/draft/beta', 'zettel/init'])
  })

  it('includes zettel/draft/ in the zettel/ subtree', () => {
    /* The spec says the graph is the zettel/ subtree, which INCLUDES
       zettel/draft/. A future change that excludes draft would need
       a separate flag; pin "include draft" here so a refactor that
       silently drops it is caught. */
    setIndex({
      paths: ['zettel/init', 'zettel/draft/new-card'],
      outgoing: {},
    })
    const ids = useGraphData().value.nodes.map((n) => n.id)
    expect(ids).toContain('zettel/draft/new-card')
  })

  it('drops wiki links that point outside the zettel/ subtree', () => {
    setIndex({
      paths: ['zettel/a', 'zettel/b', 'inbox/c'],
      outgoing: {
        'zettel/a': [
          { target: 'zettel/b', kind: 'wiki' },
          { target: 'inbox/c', kind: 'wiki' }, // cross-tree — must be filtered
        ],
        'zettel/b': [],
      },
    })
    const links = useGraphData().value.links
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({ source: 'zettel/a', target: 'zettel/b' })
  })

  it('drops non-wiki (md) links entirely', () => {
    /* docus distinguishes [[wiki]] from [text](file.md) in the link
       index. The knowledge graph shows knowledge connections (wiki
       links), not arbitrary markdown links. A regular [b](b.md)
       link in a zettel note should NOT appear in the graph. */
    setIndex({
      paths: ['zettel/a', 'zettel/b'],
      outgoing: {
        'zettel/a': [
          { target: 'zettel/b', kind: 'md' },
        ],
      },
    })
    expect(useGraphData().value.links).toEqual([])
  })

  it('drops self-links so one note does not draw a loop back to itself', () => {
    setIndex({
      paths: ['zettel/a', 'zettel/b'],
      outgoing: {
        'zettel/a': [
          { target: 'zettel/a', kind: 'wiki' },
          { target: 'zettel/b', kind: 'wiki' },
        ],
      },
    })
    expect(useGraphData().value.links).toEqual([{ source: 'zettel/a', target: 'zettel/b' }])
  })

  it('sorts links stably by source and target', () => {
    setIndex({
      paths: ['zettel/c', 'zettel/b', 'zettel/a'],
      outgoing: {
        'zettel/c': [{ target: 'zettel/a', kind: 'wiki' }],
        'zettel/a': [{ target: 'zettel/c', kind: 'wiki' }],
        'zettel/b': [{ target: 'zettel/a', kind: 'wiki' }],
      },
    })
    expect(useGraphData().value.links).toEqual([
      { source: 'zettel/a', target: 'zettel/c' },
      { source: 'zettel/b', target: 'zettel/a' },
      { source: 'zettel/c', target: 'zettel/a' },
    ])
  })

  it('keeps isolated nodes (no edges in, no edges out)', () => {
    /* A freshly-written zettel note may have no links yet. The
       user should still see it on the graph as an isolated dot
       so they know it exists. */
    setIndex({
      paths: ['zettel/lonely', 'zettel/init'],
      outgoing: {
        'zettel/init': [{ target: 'zettel/lonely', kind: 'wiki' }],
      },
    })
    const nodes = useGraphData().value.nodes
    expect(nodes).toHaveLength(2)
    const lonely = nodes.find((n) => n.id === 'zettel/lonely')!
    expect(lonely).toBeDefined()
  })

  it('uses document titles from the link index and falls back to the path basename', () => {
    setIndex({
      paths: ['zettel/a', 'zettel/ch01-where-dreams-begin'],
      outgoing: {},
      titles: {
        'zettel/a': 'Atomic Ideas',
      },
    })
    const nodes = useGraphData().value.nodes
    expect(nodes.find((n) => n.id === 'zettel/a')?.title).toBe('Atomic Ideas')
    expect(nodes.find((n) => n.id === 'zettel/ch01-where-dreams-begin')?.title).toBe('ch01-where-dreams-begin')
  })
})

describe('useGraphData — node sizing', () => {
  /* The previous binning (root=24, middle=16, leaf=12) made any
     root-of-tree page the same oversized dot and let hub notes
     blend in with quiet middle notes — see the "中间的圆太大" UX
     feedback. The replacement formula is sqrt-scaled with a cap,
     so the right thing to pin here is the *shape* of the function
     (monotone increase + cap + isolated floor) rather than exact
     values: that way the constants can be retuned without
     rewriting the tests, but a regression that re-introduces
     "every root is huge" or "hubs explode without bound" gets
     caught. We follow Obsidian's convention of using *total*
     degree (in+out), not separating them — directionality isn't
     visually informative in a force layout. */

  it('scales val with total degree (sqrt-shaped)', () => {
    /* total=1 → 11, total=2 → 12, total=4 → 14, total=9 → 17.
       Pin a few sample points to lock the sqrt shape; the gap
       between successive degrees shrinks (11→12 is +1, 12→14 is
       +2, 14→17 is +3) which is exactly what sqrt gives us. */
    const cases: Array<{ degree: number; expected: number }> = [
      { degree: 1, expected: 11 },
      { degree: 2, expected: 12 },
      { degree: 4, expected: 14 },
      { degree: 9, expected: 17 },
    ]
    for (const { degree, expected } of cases) {
      // Build a star: a hub with `degree` incoming edges from
      // distinct sources, no outgoing edges of its own.
      const paths = ['zettel/hub', ...Array.from({ length: degree }, (_, i) => `zettel/p${i}`)]
      const outgoing: Record<string, Array<{ target: string; kind: 'wiki' }>> = {}
      for (let i = 0; i < degree; i++) {
        outgoing[`zettel/p${i}`] = [{ target: 'zettel/hub', kind: 'wiki' }]
      }
      setIndex({ paths, outgoing })
      const hub = useGraphData().value.nodes.find((n) => n.id === 'zettel/hub')!
      expect(hub.val, `degree=${degree}`).toBe(expected)
    }
  })

  it('caps very-high-degree hubs (no obsidian-style blowup)', () => {
    /* Regression guard for the "中间的圆太大" bug: 20 edges
       would give 8 + round(3*sqrt(20)) = 21, but the cap clamps
       to 18. If someone removes the cap, this fails loudly. */
    const paths = ['zettel/hub', ...Array.from({ length: 20 }, (_, i) => `zettel/p${i}`)]
    const outgoing: Record<string, Array<{ target: string; kind: 'wiki' }>> = {}
    for (let i = 0; i < 20; i++) {
      outgoing[`zettel/p${i}`] = [{ target: 'zettel/hub', kind: 'wiki' }]
    }
    setIndex({ paths, outgoing })
    const hub = useGraphData().value.nodes.find((n) => n.id === 'zettel/hub')!
    expect(hub.val).toBe(18)
  })

  it('treats in-degree and out-degree as the same signal', () => {
    /* Obsidian convention: a node's size depends on its total
       number of connections, not on whether it links out or is
       linked to. A root (out=1, in=0) and a leaf (in=1, out=0)
       in the same 2-node chain both have total=1, so they
       should draw the same size — the previous binning violated
       this by giving root=24 and leaf=12. */
    setIndex({
      paths: ['zettel/root', 'zettel/leaf'],
      outgoing: {
        'zettel/root': [{ target: 'zettel/leaf', kind: 'wiki' }],
      },
    })
    const root = useGraphData().value.nodes.find((n) => n.id === 'zettel/root')!
    const leaf = useGraphData().value.nodes.find((n) => n.id === 'zettel/leaf')!
    expect(root.val).toBe(leaf.val)
  })

  it('keeps isolated nodes above the visibility floor', () => {
    /* A freshly-written zettel with no links yet has total=0. The
       formula returns BASE (8) so it shows up as a visible dot
       rather than vanishing from the graph. */
    setIndex({
      paths: ['zettel/lonely'],
      outgoing: {},
    })
    const lonely = useGraphData().value.nodes.find((n) => n.id === 'zettel/lonely')!
    expect(lonely.val).toBeGreaterThanOrEqual(6)
  })
})

describe('useGraphData — reactiveness', () => {
  it('recomputes when the link index ref changes', () => {
    setIndex({ paths: ['zettel/a'], outgoing: {} })
    expect(useGraphData().value.nodes).toHaveLength(1)

    setIndex({
      paths: ['zettel/a', 'zettel/b', 'zettel/c'],
      outgoing: {
        'zettel/a': [{ target: 'zettel/b', kind: 'wiki' }],
        'zettel/b': [{ target: 'zettel/c', kind: 'wiki' }],
      },
    })
    const next = useGraphData().value
    expect(next.nodes).toHaveLength(3)
    expect(next.links).toHaveLength(2)
  })
})
