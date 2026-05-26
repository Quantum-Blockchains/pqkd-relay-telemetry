import { buildRelayEdges, formatTime, statusClass } from '../utils/relayHelpers'

const CELL_W = 200
const CELL_H = 170
const NODE_R = 22
const PAD = 56

function gridPositions(relays) {
  const count = relays.length
  if (count === 0) return new Map()

  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)

  const positions = new Map()
  relays.forEach((relay, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const rowCount = row === rows - 1 ? count - row * cols : cols
    // center the last (possibly shorter) row
    const offsetX = ((cols - rowCount) * CELL_W) / 2
    positions.set(relay.relay_id, {
      x: PAD + offsetX + col * CELL_W + CELL_W / 2,
      y: PAD + row * CELL_H + CELL_H / 2,
    })
  })

  return positions
}

export function TopologyGraph({ relays }) {
  if (relays.length === 0) return <p className="empty">No relay data.</p>

  const cols = Math.ceil(Math.sqrt(relays.length))
  const rows = Math.ceil(relays.length / cols)
  const svgW = PAD * 2 + cols * CELL_W
  const svgH = PAD * 2 + rows * CELL_H

  const positions = gridPositions(relays)
  const edges = buildRelayEdges(relays)

  return (
    <div className="graph-wrap">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="graph"
        role="img"
        aria-label="relay topology"
      >
        <g>
          {edges.map((edge) => {
            const from = positions.get(edge.from)
            const to = positions.get(edge.to)
            if (!from || !to) return null
            const dx = to.x - from.x
            const dy = to.y - from.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const ux = dx / dist
            const uy = dy / dist
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x + ux * NODE_R}
                y1={from.y + uy * NODE_R}
                x2={to.x - ux * NODE_R}
                y2={to.y - uy * NODE_R}
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
            const cls = statusClass(relay.status)
            return (
              <g key={relay.relay_id}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={NODE_R}
                  className={`relay-node ${cls}`}
                />
                <circle
                  cx={pos.x + NODE_R * 0.7}
                  cy={pos.y - NODE_R * 0.7}
                  r={6}
                  className={`status-dot ${cls}`}
                />
                <text
                  x={pos.x}
                  y={pos.y - NODE_R - 6}
                  className="node-label"
                  textAnchor="middle"
                  fontSize="11"
                >
                  {relay.relay_id.length > 16
                    ? relay.relay_id.slice(0, 15) + '…'
                    : relay.relay_id}
                </text>
                <text
                  x={pos.x}
                  y={pos.y + NODE_R + 14}
                  className="node-sublabel"
                  textAnchor="middle"
                  fontSize="9"
                >
                  {formatTime(relay.last_seen_utc)}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

    </div>
  )
}
