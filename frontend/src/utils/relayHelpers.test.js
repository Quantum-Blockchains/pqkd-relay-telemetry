import { describe, it, expect } from 'vitest'
import { buildAdjacency, buildRelayEdges, connectedRelayIds, findTwoDisjointPaths } from './relayHelpers.js'

// Helper: build a relay list from a plain adjacency spec.
// spec: { relayId: [neighborId, ...] }
// Produces symmetric pqkd bindings so buildAdjacency reconstructs the same graph.
function makeRelays(spec) {
  return Object.entries(spec).map(([id, neighbors]) => ({
    relay_id: id,
    pqkds: neighbors.map(nb => ({
      sae_id: `${id}-${nb}`,
      paired_with: `${nb}-${id}`,
    })),
  }))
}

function isVertexDisjoint(path1, path2) {
  const mid1 = new Set(path1.slice(1, -1))
  const mid2 = new Set(path2.slice(1, -1))
  return [...mid1].every(v => !mid2.has(v))
}

function pathsConnectEndpoints(paths, start, end) {
  return paths.every(p => p[0] === start && p[p.length - 1] === end)
}

// ── Triangle ────────────────────────────────────────────────────────────────
describe('triangle (A-B-C)', () => {
  const relays = makeRelays({ A: ['B', 'C'], B: ['A', 'C'], C: ['A', 'B'] })

  it('finds two paths between A and B', () => {
    const adj = buildAdjacency(relays)
    const result = findTwoDisjointPaths(adj, 'A', 'B')
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })

  it('paths start at A and end at B', () => {
    const adj = buildAdjacency(relays)
    const [p1, p2] = findTwoDisjointPaths(adj, 'A', 'B')
    expect(pathsConnectEndpoints([p1, p2], 'A', 'B')).toBe(true)
  })

  it('intermediate nodes are vertex-disjoint', () => {
    const adj = buildAdjacency(relays)
    const [p1, p2] = findTwoDisjointPaths(adj, 'A', 'B')
    expect(isVertexDisjoint(p1, p2)).toBe(true)
  })
})

// ── Square (A-B-C-D cycle) ───────────────────────────────────────────────
describe('square (A-B-C-D)', () => {
  const relays = makeRelays({
    A: ['B', 'D'],
    B: ['A', 'C'],
    C: ['B', 'D'],
    D: ['A', 'C'],
  })

  it('finds two vertex-disjoint paths A→C', () => {
    const adj = buildAdjacency(relays)
    const result = findTwoDisjointPaths(adj, 'A', 'C')
    expect(result).not.toBeNull()
    const [p1, p2] = result
    expect(pathsConnectEndpoints([p1, p2], 'A', 'C')).toBe(true)
    expect(isVertexDisjoint(p1, p2)).toBe(true)
  })
})

// ── Linear chain (A-B-C-D) — only one path, second impossible ───────────
describe('linear chain A-B-C-D', () => {
  const relays = makeRelays({ A: ['B'], B: ['A', 'C'], C: ['B', 'D'], D: ['C'] })

  it('returns null (no second disjoint path)', () => {
    const adj = buildAdjacency(relays)
    expect(findTwoDisjointPaths(adj, 'A', 'D')).toBeNull()
  })
})

// ── Disconnected graph ────────────────────────────────────────────────────
describe('disconnected graph', () => {
  const relays = makeRelays({ A: ['B'], B: ['A'], C: ['D'], D: ['C'] })

  it('returns null when no path exists', () => {
    const adj = buildAdjacency(relays)
    expect(findTwoDisjointPaths(adj, 'A', 'C')).toBeNull()
  })
})

// ── 2×5 grid + diagonals (test_grid.py topology) ─────────────────────────
describe('2×5 grid with diagonals', () => {
  // Mirrors test_grid.py: relay-A1..relay-A5, relay-B1..relay-B5
  // Grid edges (no wrap) + diagonal edges between rows
  const ROWS = 2, COLS = 5
  const ROW = 'AB'
  const name = (r, c) => `node-${ROW[r]}${c + 1}`

  const spec = {}
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = name(r, c)
      spec[id] = []
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) spec[id].push(name(nr, nc))
      }
    }
  }
  const relays = makeRelays(spec)

  const pairs = [
    ['node-A1', 'node-B5'],
    ['node-A3', 'node-B4'],
    ['node-A1', 'node-A5'],
    ['node-B1', 'node-A5'],
  ]

  for (const [src, dst] of pairs) {
    it(`finds two vertex-disjoint paths ${src}→${dst}`, () => {
      const adj = buildAdjacency(relays)
      const result = findTwoDisjointPaths(adj, src, dst)
      expect(result).not.toBeNull()
      const [p1, p2] = result
      expect(pathsConnectEndpoints([p1, p2], src, dst)).toBe(true)
      expect(isVertexDisjoint(p1, p2)).toBe(true)
    })
  }
})

// ── buildRelayEdges — connections path ───────────────────────────────────────
describe('buildRelayEdges — connections path', () => {
  const relays = [
    { relay_id: 'r1', pqkds: [{ sae_id: 'sae-1a', paired_with: 'sae-2a' }] },
    { relay_id: 'r2', pqkds: [{ sae_id: 'sae-2a', paired_with: 'sae-1a' }, { sae_id: 'sae-2b', paired_with: 'sae-3b' }] },
    { relay_id: 'r3', pqkds: [{ sae_id: 'sae-3b', paired_with: 'sae-2b' }] },
  ]
  const edgeKeys = edges => edges.map(e => [e.from, e.to].sort().join('|')).sort()

  it('uses connections when provided — draws exactly connection edges', () => {
    const connections = [{ first: 'r1', second: 'r2' }, { first: 'r2', second: 'r3' }]
    expect(edgeKeys(buildRelayEdges(relays, connections))).toEqual(['r1|r2', 'r2|r3'])
  })

  it('draws a connections-only edge even when pqkds have no such link', () => {
    const connections = [{ first: 'r1', second: 'r3' }]
    const edges = buildRelayEdges(relays, connections)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'r1', to: 'r3' })
  })

  it('does not draw pqkd edges absent from connections', () => {
    const connections = [{ first: 'r1', second: 'r2' }]
    const keys = edgeKeys(buildRelayEdges(relays, connections))
    expect(keys).toContain('r1|r2')
    expect(keys).not.toContain('r2|r3')
  })

  it('falls back to pqkds when connections is empty', () => {
    expect(edgeKeys(buildRelayEdges(relays, []))).toEqual(['r1|r2', 'r2|r3'])
  })

  it('deduplicates reversed connections', () => {
    const connections = [{ first: 'r1', second: 'r2' }, { first: 'r2', second: 'r1' }]
    expect(buildRelayEdges(relays, connections)).toHaveLength(1)
  })

  it('populates links from pqkds for the matching connection', () => {
    const connections = [{ first: 'r1', second: 'r2' }]
    const [edge] = buildRelayEdges(relays, connections)
    expect(edge.links).toContain('sae-1a->sae-2a')
  })
})

// ── connectedRelayIds — connections path ─────────────────────────────────────
describe('connectedRelayIds — connections path', () => {
  const relays = [
    { relay_id: 'r1', pqkds: [{ sae_id: 'sae-1a', paired_with: 'sae-2a' }] },
    { relay_id: 'r2', pqkds: [{ sae_id: 'sae-2a', paired_with: 'sae-1a' }] },
    { relay_id: 'r3', pqkds: [] },
  ]

  it('returns neighbors from connections (relay in first position)', () => {
    const connections = [{ first: 'r1', second: 'r2' }, { first: 'r1', second: 'r3' }]
    const relay = relays.find(r => r.relay_id === 'r1')
    expect(connectedRelayIds(relay, relays, connections).sort()).toEqual(['r2', 'r3'])
  })

  it('returns neighbor when relay is in second position', () => {
    const connections = [{ first: 'r2', second: 'r1' }]
    const relay = relays.find(r => r.relay_id === 'r1')
    expect(connectedRelayIds(relay, relays, connections)).toEqual(['r2'])
  })

  it('falls back to pqkds when connections is empty', () => {
    const relay = relays.find(r => r.relay_id === 'r1')
    expect(connectedRelayIds(relay, relays, [])).toEqual(['r2'])
  })

  it('returns empty array for relay with no matching connections', () => {
    const connections = [{ first: 'r1', second: 'r2' }]
    const relay = relays.find(r => r.relay_id === 'r3')
    expect(connectedRelayIds(relay, relays, connections)).toEqual([])
  })

  it('deduplicates when relay appears in multiple connections to same neighbor', () => {
    const connections = [{ first: 'r1', second: 'r2' }, { first: 'r1', second: 'r2' }]
    const relay = relays.find(r => r.relay_id === 'r1')
    expect(connectedRelayIds(relay, relays, connections)).toHaveLength(1)
  })
})

// ── buildAdjacency — connections path ────────────────────────────────────────
describe('buildAdjacency — connections path', () => {
  it('uses connections and ignores pqkds when connections provided', () => {
    const relays = [
      { relay_id: 'r1', pqkds: [{ sae_id: 'sae-1a', paired_with: 'sae-2a' }] },
      { relay_id: 'r2', pqkds: [{ sae_id: 'sae-2a', paired_with: 'sae-1a' }] },
      { relay_id: 'r3', pqkds: [] },
    ]
    const connections = [{ first: 'r1', second: 'r3' }]
    const adj = buildAdjacency(relays, connections)
    expect(adj['r1']).toContain('r3')
    expect(adj['r3']).toContain('r1')
    expect(adj['r1']).not.toContain('r2')
    expect(adj['r2']).not.toContain('r1')
  })
})

// ── buildRelayEdges / buildAdjacency edge-set agreement ──────────────────────
describe('buildRelayEdges and buildAdjacency — same connections → same edge set', () => {
  it('produce identical undirected edge sets from connections', () => {
    const relays = ['A', 'B', 'C', 'D'].map(id => ({ relay_id: id, pqkds: [] }))
    const connections = [
      { first: 'A', second: 'B' },
      { first: 'B', second: 'C' },
      { first: 'A', second: 'D' },
    ]
    const edges = buildRelayEdges(relays, connections)
    const adj = buildAdjacency(relays, connections)
    const edgeSet = new Set(edges.map(e => [e.from, e.to].sort().join('|')))

    for (const [node, neighbors] of Object.entries(adj)) {
      for (const nb of neighbors) {
        expect(edgeSet.has([node, nb].sort().join('|'))).toBe(true)
      }
    }
    expect(edgeSet.size).toBe(connections.length)
  })
})
