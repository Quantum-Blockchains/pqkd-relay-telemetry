# PQKD Relay Telemetry

Telemetry platform for PQKD relay nodes.

The system ingests relay telemetry over WebSocket, keeps an in-memory grouped state by `network_id`, and exposes live updates to a React dashboard.

## Architecture

Repository layout:

- `backend/` Rust service (`axum` + `tokio`) for ingest, state aggregation, and stream delivery
- `frontend/` React app (Vite) for live table and topology views
- `docker-compose.yml` orchestration for backend + frontend

Data flow:

1. PQKD relays connect to backend WebSocket ingest endpoint.
2. First message must be `pqkd-relay.register`.
3. Subsequent messages are typically `pqkd-relay.heartbeat`.
4. Backend updates in-memory relay state keyed by `(network_id, relay_id)`.
5. Backend pushes `state.snapshot` and `state.delta` events to frontend stream clients.
6. Frontend renders:
   - grouped relay table
   - relay-to-relay topology graph

## Telemetry Contract

### Register (first message per connection)

```json
{
  "type": "pqkd-relay.register",
  "network_id": "pqkd-example-network",
  "relay_id": "relay-7",
  "pqkds": [
    { "sae_id": "Azure_16SAE", "paired_with": "Azure_15SAE" },
    { "sae_id": "Azure_17SAE", "paired_with": "Azure_18SAE" }
  ],
  "timestamp_utc": "2026-05-22T13:20:10.123+00:00"
}
```

### Heartbeat (periodic)

```json
{
  "type": "pqkd-relay.heartbeat",
  "network_id": "pqkd-example-network",
  "relay_id": "relay-7",
  "pqkds": [
    { "sae_id": "Azure_16SAE", "paired_with": "Azure_15SAE" },
    { "sae_id": "Azure_17SAE", "paired_with": "Azure_18SAE" }
  ],
  "timestamp_utc": "2026-05-22T13:20:20.123+00:00"
}
```

## Backend

### Stack

- Rust
- `axum` Web framework + WebSocket support
- `tokio` async runtime
- `tracing` structured logs

### Endpoints

- `GET /healthz` health check
- `GET /networks` grouped state snapshot
- `GET /ingest` WebSocket ingest from relays
- `GET /stream` WebSocket stream for frontend/clients

### State model

Backend stores relay state with:

- `network_id`
- `relay_id`
- `pqkds` (`[{ sae_id, paired_with }]`)
- `first_seen_utc`
- `last_seen_utc`
- `last_client_timestamp_utc`
- `event_count`
- `status` (`online`, `stale`, `offline`)

Status transitions are time-based from `last_seen_utc`:

- `online` <= 15s
- `stale` <= 30s
- `offline` > 30s

### Stream event types

- `state.snapshot` full grouped state
- `state.delta` single relay update/state change

## Frontend

### Features

- Live connection status (`connected`, `connecting`, `error`, `closed`)
- KPI cards (networks, relays, last update)
- `Table` / `Topology` view switch
- Chain filtering:
  - search by `network_id`
  - select one chain from dropdown
- Relay-to-relay topology rendering

### Topology rule

Topology edges are created from `paired_with` relationships:

- if relay A has a PQKD binding with `paired_with = X`
- and `X` is hosted (`sae_id`) by relay B
- then an edge `A <-> B` is drawn

## Run Locally (without Docker)

### Backend

```bash
cd backend
cargo run
```

Backend listens on `ws://localhost:8080`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Run with Docker Compose

From repo root:

```bash
docker compose up --build
```

Services:

- Backend: `localhost:8080`
- Frontend: `http://localhost:5173`

## Simulated Relay Grid (test_grid.py)

`test_grid.py` simulates a 2×5 relay grid with diagonal connections and feeds it to the backend via raw WebSocket. No external dependencies — requires only Python 3.10+.

**Topology**: 10 relays (`relay-A1`..`relay-A5`, `relay-B1`..`relay-B5`), grid + diagonals, no wrap-around. Corners have degree 3, interior nodes have degree 5. Every node has at least two vertex-disjoint paths to every other node.

**Offline simulation**: relays listed in `OFFLINE_RELAYS` send only a register message and disconnect. They transition to `stale` after 15 s and `offline` after 30 s — useful for testing path failover in the topology view.

```bash
# Start the backend first (Docker or cargo run), then:
python3 test_grid.py

# Before re-running: clear backend state and kill old processes
docker restart pqkd-relay-telemetry-backend
kill $(pgrep -f test_grid.py)
```

By default connects to `localhost:8080`. Edit `HOST`/`PORT` at the top of the file to change.

To mark a relay as permanently offline, add its ID to `OFFLINE_RELAYS` in `test_grid.py`:

```python
OFFLINE_RELAYS: set[str] = {"relay-A4"}
```

## Development Notes

- Backend validates ingest message order per WS connection (`register` first).
- Raw ingest payloads are printed to backend console for observability/debugging.
- Frontend consumes only backend stream events, not direct relay traffic.
