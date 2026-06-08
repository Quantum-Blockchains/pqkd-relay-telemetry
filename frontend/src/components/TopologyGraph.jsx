import { useEffect, useMemo, useRef, useState } from 'react'
import { buildAdjacency, buildRelayEdges, findTwoDisjointPaths, statusClass } from '../utils/relayHelpers'

const NODE_R  = 22
const CELL_W  = 200
const CELL_H  = 170
const PAD     = 72

function relativeTime(utcString) {
  if (!utcString) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - new Date(utcString).getTime()) / 1000))
  if (sec < 60)  return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60)  return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

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

const STATUS_COLOR = { online: 'var(--online)', stale: 'var(--stale)', offline: 'var(--offline)' }

export function TopologyGraph({ networkId, relays, connections }) {
  const [selected, setSelected] = useState([])
  const wrapRef = useRef(null)
  const [svgW, setSvgW] = useState(1100)

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setSvgW(Math.max(600, e.contentRect.width - 44))
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const cols = relays.length === 0 ? 1 : Math.ceil(Math.sqrt(relays.length))
  const rows = relays.length === 0 ? 1 : Math.ceil(relays.length / cols)
  const svgH = PAD * 2 + rows * CELL_H

  const positions = useMemo(() => gridPositions(relays, cols, rows), [relays, cols, rows])
  const edges     = useMemo(() => buildRelayEdges(relays), [relays])
  const adj       = useMemo(() => buildAdjacency(relays, connections), [relays, connections])

  const paths = useMemo(() => {
    if (selected.length !== 2) return null
    const result = findTwoDisjointPaths(adj, selected[0], selected[1])
    if (result && import.meta.env.DEV) {
      const mid1 = new Set(result[0].slice(1, -1))
      const mid2 = new Set(result[1].slice(1, -1))
      const shared = [...mid1].filter(x => mid2.has(x))
      if (shared.length) console.error('VERTEX-DISJOINT VIOLATION', shared, result)
    }
    return result
  }, [selected, adj])

  // Build edge sets for path highlighting
  const pathEdgeSets = useMemo(() => {
    if (!paths) return [new Set(), new Set()]
    return paths.map(path => {
      const s = new Set()
      for (let i = 0; i < path.length - 1; i++) s.add([path[i], path[i + 1]].sort().join('|'))
      return s
    })
  }, [paths])

  const pathNodeSet = useMemo(() => {
    if (!paths) return new Set()
    const s = new Set()
    paths.forEach(p => p.forEach(n => s.add(n)))
    return s
  }, [paths])

  function handleNodeClick(e, relayId) {
    e.stopPropagation()
    setSelected(prev => {
      // routing active → any click resets and starts fresh selection
      if (prev.length >= 2) return [relayId]
      // single selection → click same node deselects
      if (prev.includes(relayId)) return []
      return [...prev, relayId]
    })
  }

  if (relays.length === 0) return (
    <div className="net-panel"><div className="empty">No node data.</div></div>
  )

  const onlineCount  = relays.filter(r => statusClass(r.status) === 'online').length
  const staleCount   = relays.filter(r => statusClass(r.status) === 'stale').length
  const offlineCount = relays.filter(r => statusClass(r.status) === 'offline').length

  const PATH_COLORS = ['var(--path-1)', 'var(--path-2)']
  const PATH_LABELS = ['Primary route', 'Backup route']

  return (
    <div className="net-panel">
      <div className="net-header">
        <h2>{networkId}</h2>
        <div className="net-stats">
          <span className="swatch"><span className="dot online" /><strong>{onlineCount}</strong> online</span>
          <span className="swatch"><span className="dot stale"  /><strong>{staleCount}</strong> stale</span>
          <span className="swatch"><span className="dot offline"/><strong>{offlineCount}</strong> offline</span>
          {paths && (
            <span style={{ color: 'color-mix(in oklch, var(--accent) 60%, white)' }}>
              <strong>{paths.filter(Boolean).length}</strong> disjoint paths found
            </span>
          )}
        </div>
      </div>

      <div className="topo-wrap" ref={wrapRef}>
        {/* Hint overlay */}
        <div className="topo-help">
          {selected.length === 0 && 'Click a node to start Suurballe path routing'}
          {selected.length === 1 && (
            <><span>Selected </span><kbd>{selected[0]}</kbd><span> — pick a target node</span></>
          )}
          {selected.length === 2 && (
            <>
              <kbd>{selected[0]}</kbd>
              <span> → </span>
              <kbd>{selected[1]}</kbd>
              <button className="clear-btn" onClick={() => setSelected([])}>clear</button>
            </>
          )}
        </div>

        {/* Path legend */}
        {selected.length === 2 && (
          <div className="topo-pathlegend">
            {PATH_COLORS.map((color, i) => {
              const path = paths?.[i]
              const exists = !!path
              return (
                <div key={i} className="pl-row">
                  <span className="pl-line" style={{
                    background: exists ? color : 'var(--fg-3)',
                    boxShadow: exists ? `0 0 8px ${color}` : 'none',
                    opacity: exists ? 1 : 0.4,
                  }} />
                  <span style={{ opacity: exists ? 1 : 0.5 }}>{PATH_LABELS[i]}</span>
                  {exists && <span className="pl-hops">· {path.length - 1} hops</span>}
                  {!exists && i > 0 && <span style={{ color: 'var(--fg-3)' }}> — not found</span>}
                </div>
              )
            })}
          </div>
        )}

        <svg
          className="topo-svg"
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="xMidYMid meet"
          onClick={() => setSelected([])}
        >
          <defs>
            <filter id="glow-soft" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="glow-strong" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="6" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            {['online','stale','offline'].map(s => (
              <radialGradient key={s} id={`fill-${s}`}>
                <stop offset="0%"   stopColor={STATUS_COLOR[s]} stopOpacity="0.55"/>
                <stop offset="65%"  stopColor={STATUS_COLOR[s]} stopOpacity="0.12"/>
                <stop offset="100%" stopColor={STATUS_COLOR[s]} stopOpacity="0"/>
              </radialGradient>
            ))}
          </defs>

          {/* Background grid */}
          <g className="topo-grid">
            {Array.from({ length: Math.floor(svgW / 60) }).map((_, i) =>
              <line key={'v'+i} x1={i*60} y1={0} x2={i*60} y2={svgH} />
            )}
            {Array.from({ length: Math.floor(svgH / 60) }).map((_, i) =>
              <line key={'h'+i} x1={0} y1={i*60} x2={svgW} y2={i*60} />
            )}
          </g>

          {/* Base edges */}
          <g>
            {edges.map(edge => {
              const from = positions.get(edge.from)
              const to   = positions.get(edge.to)
              if (!from || !to) return null
              const ekey = [edge.from, edge.to].sort().join('|')
              const p1   = pathEdgeSets[0].has(ekey)
              const p2   = pathEdgeSets[1].has(ekey)
              const onPath = p1 || p2
              const faded  = paths && !onPath
              const color  = p1 ? 'var(--path-1)' : p2 ? 'var(--path-2)' : 'oklch(0.75 0.04 250)'
              const width  = onPath ? 2.5 : 1.2
              const opacity = faded ? 0.06 : onPath ? 0.95 : 0.18

              return (
                <g key={`${edge.from}-${edge.to}`}>
                  {onPath && (
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={color} strokeWidth={8} opacity={0.25}
                      filter="url(#glow-strong)"
                    />
                  )}
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={color} strokeWidth={width} opacity={opacity}
                    strokeLinecap="round"
                  />
                  {onPath && (
                    <circle r="3" fill={color}>
                      <animate attributeName="opacity" values="0;1;0" dur="2.2s" repeatCount="indefinite" />
                      <animateMotion dur="2.2s" repeatCount="indefinite"
                        path={`M${from.x},${from.y} L${to.x},${to.y}`}
                      />
                    </circle>
                  )}
                </g>
              )
            })}
          </g>

          {/* Nodes */}
          <g>
            {relays.map(relay => {
              const pos = positions.get(relay.relay_id)
              if (!pos) return null
              const s        = statusClass(relay.status)
              const color    = STATUS_COLOR[s]
              const isSel    = selected.includes(relay.relay_id)
              const onPath   = pathNodeSet.has(relay.relay_id)
              const faded    = paths && !onPath
              return (
                <g
                  key={relay.relay_id}
                  className="topo-node"
                  transform={`translate(${pos.x},${pos.y})`}
                  onClick={e => handleNodeClick(e, relay.relay_id)}
                  style={{ opacity: faded ? 0.3 : 1, transition: 'opacity 220ms' }}
                >
                  {/* outer halo */}
                  <circle r={NODE_R + 16} fill={`url(#fill-${s})`} />
                  {/* selection ring (animated) */}
                  {isSel && (
                    <circle r={NODE_R + 6} fill="none"
                      stroke="var(--accent)" strokeWidth="1.5"
                      style={{ filter: 'drop-shadow(0 0 6px var(--accent))' }}
                    >
                      <animate attributeName="r"
                        values={`${NODE_R+5};${NODE_R+10};${NODE_R+5}`}
                        dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity"
                        values="0.9;0.35;0.9" dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {/* core ring */}
                  <circle r={NODE_R} fill="var(--bg-1)"
                    stroke={color} strokeWidth="1.5"
                    style={{ filter: `drop-shadow(0 0 ${s === 'online' ? 6 : 3}px ${color})` }}
                  />
                  {/* inner dot */}
                  <circle r={4} fill={color}>
                    {s === 'online' && (
                      <animate attributeName="opacity" values="1;0.5;1" dur="2.4s" repeatCount="indefinite" />
                    )}
                  </circle>
                  {/* label */}
                  <text className="topo-node-label" y={-NODE_R - 10}>
                    {relay.relay_id.length > 16 ? relay.relay_id.slice(0, 15) + '…' : relay.relay_id}
                  </text>
                  <text className="topo-node-time" y={NODE_R + 16}>
                    {s === 'offline' ? '— OFFLINE —' : relativeTime(relay.last_seen_utc)}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}
