import { useEffect, useMemo, useRef, useState } from 'react'
import { useRelayStore } from './hooks/useRelayStore'
import { toSortedNetworksMap, statusClass } from './utils/relayHelpers'
import { RelayTable } from './components/RelayTable'
import { TopologyGraph } from './components/TopologyGraph'
import './styles.css'

function Sparkline({ data, color = 'var(--accent)' }) {
  if (!data || data.length < 2) return null
  const w = 64, h = 24
  const min = Math.min(...data), max = Math.max(...data)
  const span = max - min || 1
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function App() {
  const { connection, stateMap, connectionsMap, lastUpdate } = useRelayStore()
  const [view, setView]               = useState('table')
  const [chainQuery, setChainQuery]   = useState('')
  const [selectedChain, setSelectedChain] = useState('all')
  const [darkMode, setDarkMode]       = useState(true)
  const [eventHistory, setEventHistory] = useState([0])

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const allNetworks = useMemo(() => toSortedNetworksMap(stateMap), [stateMap])
  const availableChains = useMemo(() => allNetworks.map(([id]) => id), [allNetworks])

  const matchedChains = useMemo(() => {
    const q = chainQuery.trim().toLowerCase()
    return q ? availableChains.filter(id => id.toLowerCase().includes(q)) : availableChains
  }, [availableChains, chainQuery])

  const networks = useMemo(() => {
    const base = allNetworks.filter(([id]) => matchedChains.includes(id))
    return selectedChain === 'all' ? base : base.filter(([id]) => id === selectedChain)
  }, [allNetworks, matchedChains, selectedChain])

  useEffect(() => {
    if (selectedChain !== 'all' && !availableChains.includes(selectedChain)) setSelectedChain('all')
  }, [availableChains, selectedChain])

  // Totals across all networks
  const totals = useMemo(() => {
    let online = 0, stale = 0, offline = 0, events = 0
    allNetworks.forEach(([, relays]) => relays.forEach(r => {
      const s = statusClass(r.status)
      if (s === 'online') online++
      else if (s === 'stale') stale++
      else offline++
      events += r.event_count ?? 0
    }))
    return { online, stale, offline, events, total: online + stale + offline }
  }, [allNetworks])

  // Sample event rate every 3s (delta between consecutive totals → events/min)
  const SAMPLE_MS = 3000
  const totalsRef = useRef(totals)
  const prevEventsRef = useRef(0)
  useEffect(() => { totalsRef.current = totals }, [totals])
  useEffect(() => {
    const id = setInterval(() => {
      const current = totalsRef.current.events
      const delta = current - prevEventsRef.current
      prevEventsRef.current = current
      const ratePerMin = Math.round(delta * (60_000 / SAMPLE_MS))
      setEventHistory(h => [...h.slice(-19), ratePerMin])
    }, SAMPLE_MS)
    return () => clearInterval(id)
  }, [])

  const isConnected = connection === 'connected'

  return (
    <div className="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="3" />
              <circle cx="12" cy="12" r="8" strokeDasharray="2 3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
            </svg>
          </div>
          <div className="brand-text">
            <h1>Relay Telemetry</h1>
            <div className="sub">pqkd-mesh · live · network_id group view</div>
          </div>
        </div>
        <div className="topbar-right">
          <button
            className="theme-btn"
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <div className={`conn-badge ${isConnected ? '' : 'disconnected'}`}>
            <span className={`dot ${isConnected ? 'online' : 'offline'}`} />
            <span>{isConnected ? 'WS · LIVE' : `WS · ${connection.toUpperCase()}`}</span>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Networks</div>
          <div className="kpi-value">{allNetworks.length}</div>
          <div className="kpi-sub">{networks.length} visible</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Nodes</div>
          <div className="kpi-value">{totals.total}</div>
          <div className="kpi-sub">
            <span style={{ color: 'color-mix(in oklch, var(--online) 80%, white)' }}>● {totals.online}</span>
            <span style={{ color: 'color-mix(in oklch, var(--stale)  80%, white)' }}>● {totals.stale}</span>
            <span style={{ color: 'color-mix(in oklch, var(--offline) 75%, white)' }}>● {totals.offline}</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Event Rate</div>
          <div className="kpi-value" style={{ fontFeatureSettings: "'tnum'" }}>
            {eventHistory[eventHistory.length - 1]}
          </div>
          <div className="kpi-sub">events / min</div>
          <Sparkline data={eventHistory} color="var(--accent)" />
        </div>
        <div className="kpi">
          <div className="kpi-label">Last Frame</div>
          <div className="kpi-value mono">
            {lastUpdate ? new Date(lastUpdate).toLocaleTimeString([], { hour12: false }) : '—'}
          </div>
          <div className="kpi-sub">
            {lastUpdate ? new Date(lastUpdate).toISOString().slice(0, 10) : 'waiting...'}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="field">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" />
          </svg>
          <input
            type="text"
            placeholder="Filter by network_id…"
            value={chainQuery}
            onChange={e => setChainQuery(e.target.value)}
          />
        </div>
        <div className="field select" style={{ maxWidth: 220 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M6 12h12M10 18h4" />
          </svg>
          <select value={selectedChain} onChange={e => setSelectedChain(e.target.value)}>
            <option value="all">All networks</option>
            {matchedChains.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>
        <div className="seg">
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 10h18M3 15h18M9 4v16" />
            </svg>
            Table
          </button>
          <button className={view === 'topology' ? 'active' : ''} onClick={() => setView('topology')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" />
              <circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" />
              <circle cx="12" cy="12" r="2.5" />
              <path d="m8 7 3 3M16 7l-3 3M8 17l3-3M16 17l-3-3" />
            </svg>
            Topology
          </button>
        </div>
      </div>

      {/* Content */}
      {networks.length === 0 ? (
        <div className="net-panel"><div className="empty">No networks match the current filter.</div></div>
      ) : (
        networks.map(([networkId, relays]) => (
          view === 'table'
            ? <RelayTable key={networkId} networkId={networkId} relays={relays} />
            : <TopologyGraph key={networkId} networkId={networkId} relays={relays} connections={connectionsMap.get(networkId) ?? []} />
        ))
      )}
    </div>
  )
}
