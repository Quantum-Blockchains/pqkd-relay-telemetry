import { useEffect, useMemo, useState } from 'react'
import { useRelayStore } from './hooks/useRelayStore'
import { toSortedNetworksMap } from './utils/relayHelpers'
import { RelayTable } from './components/RelayTable'
import { TopologyGraph } from './components/TopologyGraph'

export default function App() {
  const { connection, stateMap, lastUpdate } = useRelayStore()
  const [view, setView] = useState('table')
  const [chainQuery, setChainQuery] = useState('')
  const [selectedChain, setSelectedChain] = useState('all')

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
    if (selectedChain !== 'all' && !availableChains.includes(selectedChain)) {
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

      <div className="toolbar">
        <section className="view-switch" aria-label="view selector">
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>
            Table
          </button>
          <button className={view === 'topology' ? 'active' : ''} onClick={() => setView('topology')}>
            Topology
          </button>
        </section>
        <div className="status-legend">
          <span><span className="legend-dot online" />Online</span>
          <span><span className="legend-dot stale" />Stale</span>
          <span><span className="legend-dot offline" />Offline</span>
        </div>
      </div>

      {networks.length === 0 ? (
        <section className="empty">No matching chain data.</section>
      ) : (
        <section className="networks">
          {networks.map(([networkId, relays]) => (
            <article key={networkId} className="network-card">
              <h2>{networkId}</h2>
              {view === 'table' ? (
                <RelayTable relays={relays} />
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
