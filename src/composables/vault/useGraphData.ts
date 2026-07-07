// Knowledge-graph data projection: take the server's link index
// snapshot (see /api/links/index) and reduce it to force-graph's
// { nodes, links } shape, restricted to the zettel/ subtree.
//
// The composable is reactive: it reads `getLinkIndex()` (a module-
// level ShallowRef populated by useLinkIndexSubscription) and
// returns a computed. The KnowledgeGraph component just `watch`es
// the computed and pipes new data into force-graph via
// `graph.graphData(next)` — which the library's `onChange` hook
// turns into an engine restart with the new node/link set.
//
// Why filter on the client and not in the link index endpoint:
// the link index is a generic cross-cutting index (used by the
// wiki link resolver, the LinksPanel, and the in-editor backlink
// preview). Restricting it to zettel/ would couple those callers
// to the zettel scope. The filter is a view-layer concern, so it
// lives here.

import { computed, type ComputedRef } from 'vue'
import { getLinkIndex } from './useLinkIndex'
import type { LinkIndexState } from './useLinkIndex'

export interface GraphNode {
  id: string
  path: string
  title: string
  val: number
}

export interface GraphLink {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

const ZETTEL_PREFIX = 'zettel/'

function titleFromPath(path: string): string {
  /* docus notes are addressable by path; the title is the basename
     for display. Falls back to the full path if a degenerate case
     lands here (e.g. trailing slash). */
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

export function buildGraphData(idx: LinkIndexState): GraphData {
  /* Stage 1: collect zettel nodes from the path index. The path
     index is authoritative for "this note exists" — we don't
     need to scan the file system. */
  const zettelNodes = new Set<string>()
  for (const p of idx.paths) {
    if (p.startsWith(ZETTEL_PREFIX)) zettelNodes.add(p)
  }

  /* Stage 2: collect intra-zettel wiki links. Both ends must be
     in the zettel set; kind must be 'wiki' (we don't surface
     regular .md links as "knowledge" connections). */
  const linkSet = new Map<string, GraphLink>()
  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  for (const source of zettelNodes) {
    const links = idx.outgoing[source] ?? []
    for (const link of links) {
      if (link.kind !== 'wiki') continue
      if (!zettelNodes.has(link.target)) continue
      if (link.target === source) continue
      const key = `${source} ${link.target}`
      if (linkSet.has(key)) continue
      linkSet.set(key, { source, target: link.target })
      inDegree.set(link.target, (inDegree.get(link.target) ?? 0) + 1)
      outDegree.set(source, (outDegree.get(source) ?? 0) + 1)
    }
  }

  /* Stage 3: derive node `val` (force-graph's size weight, which
     the canvas callback uses as the draw radius in pixels at
     scale=1 — see KnowledgeGraph.installCanvasCallback).

     The previous version binned nodes into three hard-coded sizes
     (root=24, middle=16, leaf=12), which meant every root-of-tree
     page drew the same big circle regardless of how dense its
     outgoing links actually were, and hub notes (high in-degree)
     were visually indistinguishable from quiet middle notes. The
     user complaint: "中间的圆太大了" — the central dot dominates
     the graph and obscures surrounding structure.

     New formula follows Obsidian's graph view: scale the radius
     with sqrt(degree) (so 4x more links = 2x larger dot, not 4x),
     keep an isolated-node floor (otherwise zero-degree zettels
     disappear entirely), and cap the maximum so a runaway hub
     (an inbox page that every other note links to) doesn't
     dwarf its neighbors. The numbers are tuned to land in the
     8..18 px band at globalScale=1, which reads cleanly at the
     default zoom and stays legible when the user zooms out.

       total=0   → 8   (isolated)
       total=1   → 11
       total=2   → 12
       total=4   → 14
       total=9   → 17
       total≥11  → 18  (cap) */
  const BASE = 8
  const COEFF = 3
  const MAX = 18
  const valOf = (total: number) =>
    total === 0 ? BASE : Math.min(MAX, BASE + Math.round(COEFF * Math.sqrt(total)))

  const nodes: GraphNode[] = []
  for (const id of zettelNodes) {
    const inD = inDegree.get(id) ?? 0
    const outD = outDegree.get(id) ?? 0
    const title = idx.titles?.[id]?.trim() || titleFromPath(id)
    nodes.push({ id, path: id, title, val: valOf(inD + outD) })
  }
  /* Sort by id so the layout is stable across re-runs. Without
     this, Set iteration order + outgoing key order produces a
     different node array on every refresh, which makes the
     layout jitter. */
  nodes.sort((a, b) => a.id.localeCompare(b.id))

  /* Sort edges too. force-graph seeds its simulation from the input
     arrays; stable node order alone is not enough if outgoing object
     key order changes between link-index refreshes. */
  const links = Array.from(linkSet.values())
    .sort((a, b) => (a.source + '\0' + a.target).localeCompare(b.source + '\0' + b.target))

  return { nodes, links }
}

export function useGraphData(): ComputedRef<GraphData> {
  return computed<GraphData>(() => buildGraphData(getLinkIndex().value))
}
