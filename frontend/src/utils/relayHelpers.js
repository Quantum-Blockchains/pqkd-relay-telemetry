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
