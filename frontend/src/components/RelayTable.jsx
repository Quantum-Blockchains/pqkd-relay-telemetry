import { Fragment, useState } from 'react'
import { connectedRelayIds, formatTime, statusClass } from '../utils/relayHelpers'

function StatusPill({ status }) {
  const s = statusClass(status)
  return (
    <span className={`status-pill ${s}`}>
      <span className={`dot ${s}`} />
      {s}
    </span>
  )
}

function PqkdStatusDot({ status }) {
  const cls = status === 'ok' ? 'pqkd-ok' : status === 'error' ? 'pqkd-error' : 'pqkd-unknown'
  return <span className={`pqkd-dot ${cls}`} />
}

function PqkdPanel({ pqkds }) {
  if (!pqkds?.length) return (
    <div className="pqkd-empty">No PQKD bindings reported.</div>
  )
  return (
    <table className="pqkd-table">
      <thead>
        <tr>
          <th>SAE ID</th>
          <th>Paired with</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {pqkds.map((p, i) => (
          <tr key={i}>
            <td className="pqkd-sae">{p.sae_id}</td>
            <td className="pqkd-paired">{p.paired_with}</td>
            <td>
              <span className="pqkd-status-cell">
                <PqkdStatusDot status={p.status} />
                {p.status ?? 'unknown'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function RelayTable({ networkId, relays }) {
  const [expandedId, setExpandedId] = useState(null)

  const onlineCount  = relays.filter(r => statusClass(r.status) === 'online').length
  const staleCount   = relays.filter(r => statusClass(r.status) === 'stale').length
  const offlineCount = relays.filter(r => statusClass(r.status) === 'offline').length

  const toggle = (id) => setExpandedId(prev => prev === id ? null : id)

  return (
    <div className="net-panel">
      <div className="net-header">
        <h2>{networkId}</h2>
        <div className="net-stats">
          <span className="swatch"><span className="dot online" /><strong>{onlineCount}</strong> online</span>
          <span className="swatch"><span className="dot stale"  /><strong>{staleCount}</strong> stale</span>
          <span className="swatch"><span className="dot offline"/><strong>{offlineCount}</strong> offline</span>
        </div>
      </div>
      {relays.length === 0 ? (
        <div className="empty">No nodes connected.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Node ID</th>
              <th>Status</th>
              <th>Connections</th>
              <th>Last seen</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {relays.map(relay => {
              const isOpen = expandedId === relay.relay_id
              return (
                <Fragment key={relay.relay_id}>
                  <tr
                    key={relay.relay_id}
                    className={`row-expandable${isOpen ? ' row-open' : ''}`}
                    onClick={() => toggle(relay.relay_id)}
                  >
                    <td className="cell-id">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <svg
                          className={`chevron${isOpen ? ' chevron-open' : ''}`}
                          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"
                        >
                          <path d="M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className={`dot ${statusClass(relay.status)}`} />
                        {relay.relay_id}
                      </span>
                    </td>
                    <td><StatusPill status={relay.status} /></td>
                    <td className="cell-conns">
                      {connectedRelayIds(relay, relays).map(id => (
                        <span key={id} className="chip">{id}</span>
                      ))}
                    </td>
                    <td className="cell-time">{formatTime(relay.last_seen_utc)}</td>
                    <td className="cell-events">{relay.event_count?.toLocaleString() ?? '—'}</td>
                  </tr>
                  {isOpen && (
                    <tr className="row-detail">
                      <td colSpan={5}>
                        <PqkdPanel pqkds={relay.pqkds} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
