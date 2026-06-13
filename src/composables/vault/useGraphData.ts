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

export function useGraphData(): ComputedRef<GraphData> {
  return computed<GraphData>(() => {
    const idx = getLinkIndex().value
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
        const key = `${source} ${link.target}`
        if (linkSet.has(key)) continue
        linkSet.set(key, { source, target: link.target })
        inDegree.set(link.target, (inDegree.get(link.target) ?? 0) + 1)
        outDegree.set(source, (outDegree.get(source) ?? 0) + 1)
      }
    }

    /* Stage 3: derive node `val` (force-graph's size weight) from
       degree. Center-like (no incoming): big. Leaf (no outgoing):
       small. Middle: medium. Isolated nodes (no in, no out) fall
       through with the medium default — they're still visible,
       just not over-emphasized. */
    const nodes: GraphNode[] = []
    for (const id of zettelNodes) {
      const inD = inDegree.get(id) ?? 0
      const outD = outDegree.get(id) ?? 0
      let val = 16
      if (inD === 0 && outD > 0) val = 24
      else if (outD === 0 && inD > 0) val = 12
      nodes.push({ id, path: id, title: titleFromPath(id), val })
    }
    /* Sort by id so the layout is stable across re-runs. Without
       this, Set iteration order + outgoing key order produces a
       different node array on every refresh, which makes the
       layout jitter. */
    nodes.sort((a, b) => a.id.localeCompare(b.id))

    return { nodes, links: Array.from(linkSet.values()) }
  })
}
