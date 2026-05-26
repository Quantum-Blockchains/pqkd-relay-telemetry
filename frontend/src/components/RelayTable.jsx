import { connectedRelayIds, formatTime, statusClass } from '../utils/relayHelpers'

export function RelayTable({ relays }) {
  if (relays.length === 0) return <p className="empty-state">No relays connected.</p>
  return (
    <div className="table-wrap">
      <table>
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
          {relays.map((relay) => (
            <tr key={relay.relay_id}>
              <td>{relay.relay_id}</td>
              <td>
                <span className={`status ${statusClass(relay.status)}`}>{relay.status}</span>
              </td>
              <td>
                <div className="conn-list">
                  {connectedRelayIds(relay, relays).map((id) => (
                    <span key={id} className="conn-pill">{id}</span>
                  ))}
                </div>
              </td>
              <td className="nowrap">{formatTime(relay.last_seen_utc)}</td>
              <td>{relay.event_count?.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
