import { describe, it, expect } from 'vitest'
import { buildAdjacency, findTwoDisjointPaths } from './relayHelpers.js'

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
  const name = (r, c) => `relay-${ROW[r]}${c + 1}`

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
    ['relay-A1', 'relay-B5'],
    ['relay-A3', 'relay-B4'],
    ['relay-A1', 'relay-A5'],
    ['relay-B1', 'relay-A5'],
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
