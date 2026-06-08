import { useCallback, useEffect, useRef, useState } from 'react'
import { toMapFromNetworks } from '../utils/relayHelpers'

const STREAM_URL = import.meta.env.VITE_STREAM_URL || 'ws://localhost:8080/stream'
const BACKOFF_MAX_MS = 60_000

export function useRelayStore() {
  const [connection, setConnection] = useState('connecting')
  const [stateMap, setStateMap] = useState(new Map())
  const [connectionsMap, setConnectionsMap] = useState(new Map())
  const [lastUpdate, setLastUpdate] = useState(null)

  const retryRef = useRef(0)
  const timerRef = useRef(null)
  const wsRef = useRef(null)
  const cancelledRef = useRef(false)

  const connect = useCallback(() => {
    const ws = new WebSocket(STREAM_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnection('connected')
      retryRef.current = 0
    }

    ws.onerror = () => setConnection('error')

    ws.onclose = () => {
      if (cancelledRef.current) return
      setConnection('closed')
      const delay = Math.min(1000 * 2 ** retryRef.current, BACKOFF_MAX_MS)
      retryRef.current += 1
      timerRef.current = setTimeout(connect, delay)
    }

    ws.onmessage = (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }

      if (data.type === 'state.snapshot') {
        setStateMap(toMapFromNetworks(data.networks))
        const conns = new Map()
        for (const net of data.networks || []) {
          if (net.connections?.length) conns.set(net.network_id, net.connections)
        }
        setConnectionsMap(conns)
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
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    connect()
    return () => {
      cancelledRef.current = true
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { connection, stateMap, connectionsMap, lastUpdate }
}
