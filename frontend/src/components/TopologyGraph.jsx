import { useMemo, useState } from 'react'
import { buildAdjacency, buildRelayEdges, findTwoDisjointPaths, formatTime, statusClass } from '../utils/relayHelpers'

const CELL_W = 200
const CELL_H = 170
const NODE_R = 22
const PAD = 56

const PATH_COLORS = ['#60a5fa', '#fb923c']

function gridPositions(relays, cols, rows) {
  const count = relays.length
  if (count === 0) return new Map()

  const positions = new Map()
  relays.forEach((relay, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const rowCount = row === rows - 1 ? count - row * cols : cols
    const offsetX = ((cols - rowCount) * CELL_W) / 2
    positions.set(relay.relay_id, {
      x: PAD + offsetX + col * CELL_W + CELL_W / 2,
      y: PAD + row * CELL_H + CELL_H / 2,
    })
  })

  return positions
}

function pathLine(positions, nodeA, nodeB, color, key) {
  const from = positions.get(nodeA)
  const to = positions.get(nodeB)
  if (!from || !to) return null
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  return (
    <line
      key={key}
      x1={from.x + ux * NODE_R}
      y1={from.y + uy * NODE_R}
      x2={to.x - ux * NODE_R}
      y2={to.y - uy * NODE_R}
      stroke={color}
      strokeWidth={3.5}
      strokeOpacity={0.7}
      strokeLinecap="round"
    />
  )
}

export function TopologyGraph({ relays }) {
  const [selected, setSelected] = useState([])

  const cols = relays.length === 0 ? 1 : Math.ceil(Math.sqrt(relays.length))
  const rows = relays.length === 0 ? 1 : Math.ceil(relays.length / cols)
  const svgW = PAD * 2 + cols * CELL_W
  const svgH = PAD * 2 + rows * CELL_H

  const positions = useMemo(() => gridPositions(relays, cols, rows), [relays, cols, rows])
  const edges = useMemo(() => buildRelayEdges(relays), [relays])
  const adj = useMemo(() => buildAdjacency(relays), [relays])

  const paths = useMemo(() => {
    if (selected.length !== 2) return null
    const result = findTwoDisjointPaths(adj, selected[0], selected[1])
    if (result && import.meta.env.DEV) {
      const mid1 = new Set(result[0].slice(1, -1))
      const mid2 = new Set(result[1].slice(1, -1))
      const shared = [...mid1].filter(x => mid2.has(x))
      if (shared.length) console.error('VERTEX-DISJOINT VIOLATION', shared, result)
      else console.log('Paths OK:', result[0].join('→'), '|', result[1].join('→'))
    }
    return result
  }, [selected, adj])

  if (relays.length === 0) return <p className="empty">No relay data.</p>

  function handleNodeClick(e, relayId) {
    e.stopPropagation()
    setSelected(prev => {
      if (prev.length === 0) return [relayId]
      if (prev[0] === relayId) return []
      if (prev.length === 1) return [prev[0], relayId]
      return [relayId]
    })
  }

  return (
    <div className="graph-wrap">
      {selected.length === 1 && (
        <p className="path-hint">Select a second node to find the two disjoint paths.</p>
      )}
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="graph"
        role="img"
        aria-label="relay topology"
        onClick={() => setSelected([])}
        style={{ cursor: 'default' }}
      >
        {/* Base edges */}
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
                opacity={paths ? 0.25 : 0.8}
              >
                <title>{`${edge.from} ↔ ${edge.to} | ${edge.links.join(', ')}`}</title>
              </line>
            )
          })}
        </g>

        {/* Suurballe path overlays */}
        {paths && paths.map((path, pi) =>
          path.slice(0, -1).map((nodeId, i) =>
            pathLine(positions, nodeId, path[i + 1], PATH_COLORS[pi], `p${pi}-${i}`)
          )
        )}

        {/* Nodes */}
        <g>
          {relays.map((relay) => {
            const pos = positions.get(relay.relay_id)
            if (!pos) return null
            const cls = statusClass(relay.status)
            const isSelected = selected.includes(relay.relay_id)
            return (
              <g
                key={relay.relay_id}
                onClick={(e) => handleNodeClick(e, relay.relay_id)}
                style={{ cursor: 'pointer' }}
              >
                {isSelected && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={NODE_R + 6}
                    fill="none"
                    stroke="#eab308"
                    strokeWidth={3}
                  />
                )}
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

        {/* Path legend */}
        {paths && (
          <g>
            {PATH_COLORS.map((color, i) => (
              <g key={i}>
                <line x1={12} y1={svgH - 28 + i * 16} x2={30} y2={svgH - 28 + i * 16} stroke={color} strokeWidth={3} strokeLinecap="round" />
                <text x={36} y={svgH - 23 + i * 16} fontSize="11" fill="#445b80">Path {i + 1}</text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  )
}
