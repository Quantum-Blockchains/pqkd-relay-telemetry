import { useEffect, useMemo, useState } from 'react'

const STREAM_URL = 'ws://localhost:8080/stream'

function toMapFromNetworks(networks) {
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

function toSortedNetworksMap(stateMap) {
  return [...stateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([networkId, relayMap]) => {
      const relays = [...relayMap.values()].sort((a, b) => a.relay_id.localeCompare(b.relay_id))
      return [networkId, relays]
    })
}

function statusClass(status) {
  return status || 'offline'
}

function buildRelayEdges(relays) {
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

function TopologyGraph({ relays }) {
  const width = 1100
  const height = 640
  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.min(width, height) * 0.34
  const nodeRadius = 24

  const edges = buildRelayEdges(relays)

  const positions = new Map(
    relays.map((relay, index) => {
      const angle = (2 * Math.PI * index) / Math.max(relays.length, 1) - Math.PI / 2
      return [
        relay.relay_id,
        {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        },
      ]
    })
  )

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="graph" role="img" aria-label="relay topology">
        <g>
          {edges.map((edge) => {
            const from = positions.get(edge.from)
            const to = positions.get(edge.to)
            if (!from || !to) return null
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="edge"
              >
                <title>{`${edge.from} ↔ ${edge.to} | ${edge.links.join(', ')}`}</title>
              </line>
            )
          })}
        </g>

        <g>
          {relays.map((relay) => {
            const pos = positions.get(relay.relay_id)
            if (!pos) return null
            return (
              <g key={relay.relay_id}>
                <circle cx={pos.x} cy={pos.y} r={nodeRadius} className={`relay-node ${statusClass(relay.status)}`} />
                <text x={pos.x} y={pos.y + 45} className="node-label" textAnchor="middle">
                  {relay.relay_id}
                </text>
              </g>
            )
          })}
        </g>

        <text x={centerX} y={34} className="group-label" textAnchor="middle">
          Relay-to-Relay Topology
        </text>
      </svg>
    </div>
  )
}

export default function App() {
  const [connection, setConnection] = useState('connecting')
  const [lastUpdate, setLastUpdate] = useState(null)
  const [stateMap, setStateMap] = useState(new Map())
  const [view, setView] = useState('table')
  const [chainQuery, setChainQuery] = useState('')
  const [selectedChain, setSelectedChain] = useState('all')

  useEffect(() => {
    const ws = new WebSocket(STREAM_URL)

    ws.onopen = () => setConnection('connected')
    ws.onerror = () => setConnection('error')
    ws.onclose = () => setConnection('closed')

    ws.onmessage = (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }

      if (data.type === 'state.snapshot') {
        setStateMap(toMapFromNetworks(data.networks))
        setLastUpdate(data.generated_at_utc)
        return
      }

      if (data.type === 'state.delta' && data.relay) {
        setStateMap((prev) => {
          const next = new Map(prev)
          const networkId = data.relay.network_id
          const relayId = data.relay.relay_id
          const existing = next.get(networkId) || new Map()
          const relayMap = new Map(existing)
          relayMap.set(relayId, data.relay)
          next.set(networkId, relayMap)
          return next
        })
        setLastUpdate(data.generated_at_utc)
      }
    }

    return () => ws.close()
  }, [])

  const allNetworks = useMemo(() => toSortedNetworksMap(stateMap), [stateMap])
  const availableChains = useMemo(() => allNetworks.map(([networkId]) => networkId), [allNetworks])

  const matchedChains = useMemo(() => {
    const q = chainQuery.trim().toLowerCase()
    if (!q) return availableChains
    return availableChains.filter((id) => id.toLowerCase().includes(q))
  }, [availableChains, chainQuery])

  const networks = useMemo(() => {
    const base = allNetworks.filter(([networkId]) => matchedChains.includes(networkId))
    if (selectedChain === 'all') return base
    return base.filter(([networkId]) => networkId === selectedChain)
  }, [allNetworks, matchedChains, selectedChain])

  useEffect(() => {
    if (selectedChain === 'all') return
    if (!availableChains.includes(selectedChain)) {
      setSelectedChain('all')
    }
  }, [availableChains, selectedChain])

  const relayCount = useMemo(
    () => networks.reduce((sum, [, relays]) => sum + relays.length, 0),
    [networks]
  )

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>PQKD Relay Telemetry</h1>
          <p className="sub">Live grouped state by network_id</p>
        </div>
        <div className={`badge ${connection}`}>{connection}</div>
      </header>

      <section className="stats">
        <article className="stat">
          <span>Networks</span>
          <strong>{networks.length}</strong>
        </article>
        <article className="stat">
          <span>Relays</span>
          <strong>{relayCount}</strong>
        </article>
        <article className="stat">
          <span>Last Update</span>
          <strong>{lastUpdate ? new Date(lastUpdate).toLocaleString() : 'n/a'}</strong>
        </article>
      </section>

      <section className="controls">
        <label className="control">
          <span>Search chain</span>
          <input
            type="text"
            placeholder="Type network_id..."
            value={chainQuery}
            onChange={(e) => setChainQuery(e.target.value)}
          />
        </label>

        <label className="control">
          <span>Select chain</span>
          <select value={selectedChain} onChange={(e) => setSelectedChain(e.target.value)}>
            <option value="all">All matching chains</option>
            {matchedChains.map((chainId) => (
              <option key={chainId} value={chainId}>
                {chainId}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="view-switch" aria-label="view selector">
        <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>
          Table
        </button>
        <button className={view === 'topology' ? 'active' : ''} onClick={() => setView('topology')}>
          Topology
        </button>
      </section>

      {networks.length === 0 ? (
        <section className="empty">No matching chain data.</section>
      ) : (
        <section className="networks">
          {networks.map(([networkId, relays]) => (
            <article key={networkId} className="network-card">
              <h2>{networkId}</h2>

              {view === 'table' ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>relay_id</th>
                        <th>status</th>
                        <th>pqkds</th>
                        <th>last_seen_utc</th>
                        <th>event_count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relays.map((relay) => (
                        <tr key={relay.relay_id}>
                          <td>{relay.relay_id}</td>
                          <td>
                            <span className={`status ${statusClass(relay.status)}`}>{relay.status}</span>
                          </td>
                          <td>
                            {(relay.pqkds || [])
                              .map((binding) => `${binding.sae_id}->${binding.paired_with}`)
                              .join(', ')}
                          </td>
                          <td>{relay.last_seen_utc}</td>
                          <td>{relay.event_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <TopologyGraph relays={relays} />
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
