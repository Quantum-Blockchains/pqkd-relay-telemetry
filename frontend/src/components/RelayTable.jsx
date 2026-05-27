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

export function RelayTable({ networkId, relays }) {
  const onlineCount  = relays.filter(r => statusClass(r.status) === 'online').length
  const staleCount   = relays.filter(r => statusClass(r.status) === 'stale').length
  const offlineCount = relays.filter(r => statusClass(r.status) === 'offline').length

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
        <div className="empty">No relays connected.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Relay ID</th>
              <th>Status</th>
              <th>Connections</th>
              <th>Last seen</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {relays.map(relay => (
              <tr key={relay.relay_id}>
                <td className="cell-id">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
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
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
