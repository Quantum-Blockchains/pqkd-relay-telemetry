export function toMapFromNetworks(networks) {
  const map = new Map()
  for (const network of networks || []) {
    const relayMap = new Map()
    for (const relay of network.relays || []) {
      relayMap.set(relay.relay_id, relay)
    }
    map.set(network.network_id, relayMap)
  }
  return map
}

export function toSortedNetworksMap(stateMap) {
  return [...stateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([networkId, relayMap]) => {
      const relays = [...relayMap.values()].sort((a, b) => a.relay_id.localeCompare(b.relay_id))
      return [networkId, relays]
    })
}

export function statusClass(status) {
  return status || 'offline'
}

export function formatTime(utcString) {
  if (!utcString) return '—'
  return new Date(utcString).toLocaleTimeString()
}

export function connectedRelayIds(relay, allRelays) {
  const ownerBySaeId = new Map()
  for (const r of allRelays) {
    for (const b of r.pqkds || []) {
      if (b?.sae_id) ownerBySaeId.set(b.sae_id, r.relay_id)
    }
  }
  const result = new Set()
  for (const b of relay.pqkds || []) {
    const target = ownerBySaeId.get(b?.paired_with)
    if (target && target !== relay.relay_id) result.add(target)
  }
  return [...result]
}

export function buildAdjacency(relays) {
  const adj = {}
  for (const relay of relays) adj[relay.relay_id] = []

  const ownerBySaeId = {}
  for (const relay of relays) {
    for (const b of relay.pqkds || []) {
      if (b?.sae_id) ownerBySaeId[b.sae_id] = relay.relay_id
    }
  }

  const seen = new Set()
  for (const relay of relays) {
    for (const b of relay.pqkds || []) {
      const target = ownerBySaeId[b?.paired_with]
      if (!target || target === relay.relay_id) continue
      const edgeKey = [relay.relay_id, target].sort().join('::')
      if (seen.has(edgeKey)) continue
      seen.add(edgeKey)
      adj[relay.relay_id].push(target)
      adj[target].push(relay.relay_id)
    }
  }
  return adj
}

// Suurballe's algorithm (vertex-disjoint paths).
// adj: plain object { relayId: [neighborId, ...] }
// Returns [path1, path2] arrays of relay IDs, or null.
export function findTwoDisjointPaths(adj, start, end) {
  const nodes = Object.keys(adj)
  const inOf  = v => (v === start || v === end) ? v : `${v}_in`
  const outOf = v => (v === start || v === end) ? v : `${v}_out`

  // Build split directed graph
  const split = new Map()
  for (const v of nodes) {
    if (!split.has(inOf(v)))  split.set(inOf(v), [])
    if (!split.has(outOf(v))) split.set(outOf(v), [])
    if (v !== start && v !== end) {
      split.get(`${v}_in`).push([`${v}_out`, 0])
    }
  }
  for (const u of nodes) {
    for (const v of adj[u]) {
      split.get(outOf(u)).push([inOf(v), 1])
    }
  }

  const dijkstra = (graph, src) => {
    const dist = new Map()
    const prev = new Map()
    const unvisited = new Set(graph.keys())
    dist.set(src, 0)
    while (unvisited.size > 0) {
      let u = null, minD = Infinity
      for (const n of unvisited) {
        const d = dist.get(n) ?? Infinity
        if (d < minD) { minD = d; u = n }
      }
      if (!u || minD === Infinity) break
      unvisited.delete(u)
      for (const [v, w] of (graph.get(u) ?? [])) {
        const nd = minD + w
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd)
          prev.set(v, u)
        }
      }
    }
    return { dist, prev }
  }

  const reconstruct = (prev, src, dst) => {
    const path = [dst]
    let cur = dst
    while (cur !== src) {
      const p = prev.get(cur)
      if (p === undefined) return null
      path.push(p); cur = p
    }
    return path.reverse()
  }

  // Step 1: first Dijkstra
  const { dist: dist1, prev: prev1 } = dijkstra(split, start)
  if ((dist1.get(end) ?? Infinity) === Infinity) return null
  const p1s = reconstruct(prev1, start, end)
  if (!p1s) return null

  // Step 2: Johnson reweight + reverse P1 edges
  const modified = new Map()
  for (const [u, neighbors] of split) {
    const du = dist1.get(u) ?? Infinity
    modified.set(u, [])
    for (const [v, w] of neighbors) {
      const dv = dist1.get(v) ?? Infinity
      if (du !== Infinity && dv !== Infinity) {
        modified.get(u).push([v, w + du - dv])
      }
    }
  }
  for (let i = 0; i < p1s.length - 1; i++) {
    const [u, v] = [p1s[i], p1s[i + 1]]
    const edges = modified.get(u)
    if (edges) { const idx = edges.findIndex(([n]) => n === v); if (idx !== -1) edges.splice(idx, 1) }
    if (!modified.has(v)) modified.set(v, [])
    modified.get(v).push([u, 0])
  }

  // Step 3: second Dijkstra
  const { prev: prev2 } = dijkstra(modified, start)
  const p2s = reconstruct(prev2, start, end)
  if (!p2s) return null

  // Step 4: merge + cancel opposing edges
  const bag = new Map()
  const ekey = (u, v) => `${u}|||${v}`
  for (let i = 0; i < p1s.length - 1; i++) {
    const k = ekey(p1s[i], p1s[i + 1]); bag.set(k, (bag.get(k) ?? 0) + 1)
  }
  for (let i = 0; i < p2s.length - 1; i++) {
    const k = ekey(p2s[i], p2s[i + 1]); bag.set(k, (bag.get(k) ?? 0) + 1)
  }
  for (const k of [...bag.keys()]) {
    const [u, v] = k.split('|||')
    const rev = ekey(v, u)
    if (bag.has(rev)) {
      const cancel = Math.min(bag.get(k), bag.get(rev))
      bag.set(k, bag.get(k) - cancel)
      bag.set(rev, bag.get(rev) - cancel)
    }
  }

  // Step 5: trace two paths from surviving edges
  const adj2 = new Map()
  for (const [k, cnt] of bag) {
    if (cnt <= 0) continue
    const [u, v] = k.split('|||')
    if (!adj2.has(u)) adj2.set(u, [])
    for (let i = 0; i < cnt; i++) adj2.get(u).push(v)
  }
  const tracePath = (a, src, dst) => {
    const path = [src]; let cur = src
    while (cur !== dst) {
      const ns = a.get(cur)
      if (!ns?.length) return null
      const next = ns.shift(); path.push(next); cur = next
    }
    return path
  }
  const r1 = tracePath(adj2, start, end)
  const r2 = tracePath(adj2, start, end)
  if (!r1 || !r2) return null

  const toOrig = path => {
    const out = []
    for (const n of path) {
      const name = n.replace(/_in$/, '').replace(/_out$/, '')
      if (out[out.length - 1] !== name) out.push(name)
    }
    return out
  }
  return [toOrig(r1), toOrig(r2)]
}

export function buildRelayEdges(relays) {
  const ownerBySaeId = new Map()
  for (const relay of relays) {
    for (const binding of relay.pqkds || []) {
      if (binding?.sae_id) {
        ownerBySaeId.set(binding.sae_id, relay.relay_id)
      }
    }
  }

  const edgeMap = new Map()
  for (const relay of relays) {
    for (const binding of relay.pqkds || []) {
      const targetRelayId = ownerBySaeId.get(binding?.paired_with)
      if (!targetRelayId || targetRelayId === relay.relay_id) continue

      const [a, b] = [relay.relay_id, targetRelayId].sort((x, y) => x.localeCompare(y))
      const key = `${a}::${b}`
      const current = edgeMap.get(key) || { from: a, to: b, links: [] }
      current.links.push(`${binding.sae_id}->${binding.paired_with}`)
      edgeMap.set(key, current)
    }
  }

  return [...edgeMap.values()]
}
