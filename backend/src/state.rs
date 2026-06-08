use crate::models::{
    IngestMessage, NetworkView, NetworksSnapshot, PqkdBinding, RelayHeartbeat, RelayRegister,
    RelayStatus, RelayView, StreamEvent, TopologyEdge,
};
use chrono::{DateTime, Duration, Utc};
use std::collections::{BTreeMap, HashMap};
use tokio::sync::{RwLock, broadcast};

const STALE_AFTER_SECONDS: i64 = 15;
const OFFLINE_AFTER_SECONDS: i64 = 30;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RelayKey {
    network_id: String,
    relay_id: String,
}

#[derive(Debug, Clone)]
struct RelayState {
    network_id: String,
    relay_id: String,
    pqkds: Vec<PqkdBinding>,
    first_seen_utc: DateTime<Utc>,
    last_seen_utc: DateTime<Utc>,
    last_client_timestamp_utc: DateTime<Utc>,
    event_count: u64,
    status: RelayStatus,
}

#[derive(Clone)]
pub struct AppState {
    pub store: std::sync::Arc<TelemetryStore>,
}

pub struct TelemetryStore {
    inner: RwLock<HashMap<RelayKey, RelayState>>,
    topology: RwLock<HashMap<String, Vec<TopologyEdge>>>,
    stream_tx: broadcast::Sender<String>,
}

impl TelemetryStore {
    pub fn new(stream_tx: broadcast::Sender<String>) -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            topology: RwLock::new(HashMap::new()),
            stream_tx,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.stream_tx.subscribe()
    }

    pub async fn apply_event(&self, event: IngestMessage) {
        let now = Utc::now();

        if let IngestMessage::Register(ref payload) = event {
            if !payload.connections.is_empty() {
                self.topology
                    .write()
                    .await
                    .insert(payload.network_id.clone(), payload.connections.clone());
            }
        }

        let delta = {
            let mut guard = self.inner.write().await;
            let state = match event {
                IngestMessage::Register(payload) => upsert_from_register(&mut guard, payload, now),
                IngestMessage::Heartbeat(payload) => {
                    upsert_from_heartbeat(&mut guard, payload, now)
                }
            };
            state.clone()
        };

        let stream_event = StreamEvent::Delta {
            generated_at_utc: now,
            relay: to_view(&delta),
        };
        self.emit(stream_event);
    }

    pub async fn refresh_statuses(&self) {
        let now = Utc::now();
        let mut changed = Vec::new();
        {
            let mut guard = self.inner.write().await;
            for state in guard.values_mut() {
                let new_status = status_from_last_seen(state.last_seen_utc, now);
                if new_status != state.status {
                    state.status = new_status;
                    changed.push(state.clone());
                }
            }
        }

        for state in changed {
            self.emit(StreamEvent::Delta {
                generated_at_utc: now,
                relay: to_view(&state),
            });
        }
    }

    pub async fn snapshot(&self) -> NetworksSnapshot {
        let guard = self.inner.read().await;
        let topo_guard = self.topology.read().await;
        let mut grouped: BTreeMap<String, Vec<RelayView>> = BTreeMap::new();
        for state in guard.values() {
            grouped
                .entry(state.network_id.clone())
                .or_default()
                .push(to_view(state));
        }

        for relays in grouped.values_mut() {
            relays.sort_by(|a, b| a.relay_id.cmp(&b.relay_id));
        }

        let networks = grouped
            .into_iter()
            .map(|(network_id, relays)| {
                let connections = topo_guard.get(&network_id).cloned().unwrap_or_default();
                NetworkView {
                    network_id,
                    relays,
                    connections,
                }
            })
            .collect();

        NetworksSnapshot {
            generated_at_utc: Utc::now(),
            networks,
        }
    }

    pub async fn snapshot_event_json(&self) -> Result<String, serde_json::Error> {
        let snapshot = self.snapshot().await;
        serde_json::to_string(&StreamEvent::Snapshot {
            generated_at_utc: snapshot.generated_at_utc,
            networks: snapshot.networks,
        })
    }

    fn emit(&self, event: StreamEvent) {
        if let Ok(payload) = serde_json::to_string(&event) {
            let _ = self.stream_tx.send(payload);
        }
    }
}

fn upsert_from_register(
    states: &mut HashMap<RelayKey, RelayState>,
    payload: RelayRegister,
    now: DateTime<Utc>,
) -> &RelayState {
    let key = RelayKey {
        network_id: payload.network_id.clone(),
        relay_id: payload.relay_id.clone(),
    };

    let state = states.entry(key).or_insert_with(|| RelayState {
        network_id: payload.network_id.clone(),
        relay_id: payload.relay_id.clone(),
        pqkds: payload.pqkds.clone(),
        first_seen_utc: now,
        last_seen_utc: now,
        last_client_timestamp_utc: payload.timestamp_utc,
        event_count: 0,
        status: RelayStatus::Online,
    });

    state.pqkds = payload.pqkds;
    state.last_seen_utc = now;
    state.last_client_timestamp_utc = payload.timestamp_utc;
    state.event_count += 1;
    state.status = status_from_last_seen(state.last_seen_utc, now);
    state
}

fn upsert_from_heartbeat(
    states: &mut HashMap<RelayKey, RelayState>,
    payload: RelayHeartbeat,
    now: DateTime<Utc>,
) -> &RelayState {
    let key = RelayKey {
        network_id: payload.network_id.clone(),
        relay_id: payload.relay_id.clone(),
    };

    let state = states.entry(key).or_insert_with(|| RelayState {
        network_id: payload.network_id.clone(),
        relay_id: payload.relay_id.clone(),
        pqkds: payload.pqkds.clone(),
        first_seen_utc: now,
        last_seen_utc: now,
        last_client_timestamp_utc: payload.timestamp_utc,
        event_count: 0,
        status: RelayStatus::Online,
    });

    state.pqkds = payload.pqkds;
    state.last_seen_utc = now;
    state.last_client_timestamp_utc = payload.timestamp_utc;
    state.event_count += 1;
    state.status = status_from_last_seen(state.last_seen_utc, now);
    state
}

fn to_view(state: &RelayState) -> RelayView {
    RelayView {
        network_id: state.network_id.clone(),
        relay_id: state.relay_id.clone(),
        pqkds: state.pqkds.clone(),
        status: state.status,
        first_seen_utc: state.first_seen_utc,
        last_seen_utc: state.last_seen_utc,
        last_client_timestamp_utc: state.last_client_timestamp_utc,
        event_count: state.event_count,
    }
}

fn status_from_last_seen(last_seen: DateTime<Utc>, now: DateTime<Utc>) -> RelayStatus {
    let age = now - last_seen;
    if age <= Duration::seconds(STALE_AFTER_SECONDS) {
        RelayStatus::Online
    } else if age <= Duration::seconds(OFFLINE_AFTER_SECONDS) {
        RelayStatus::Stale
    } else {
        RelayStatus::Offline
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::PqkdStatus;

    async fn make_store() -> TelemetryStore {
        let (tx, _) = broadcast::channel(16);
        TelemetryStore::new(tx)
    }

    #[tokio::test]
    async fn pqkd_status_preserved_through_pipeline() {
        let store = make_store().await;

        let heartbeat_json = r#"{
            "type": "pqkd-relay.heartbeat",
            "network_id": "net1",
            "relay_id": "relay-a",
            "pqkds": [{"sae_id": "sae-a", "paired_with": "sae-b", "status": "ok"}],
            "timestamp_utc": "2026-01-01T00:00:00Z"
        }"#;

        let event: IngestMessage = serde_json::from_str(heartbeat_json).unwrap();
        store.apply_event(event).await;

        let snapshot = store.snapshot().await;
        let relay = &snapshot.networks[0].relays[0];
        assert_eq!(relay.pqkds[0].status, PqkdStatus::Ok);
    }

    #[tokio::test]
    async fn pqkd_status_in_snapshot_json_output() {
        let store = make_store().await;

        let heartbeat_json = r#"{
            "type": "pqkd-relay.heartbeat",
            "network_id": "net1",
            "relay_id": "relay-a",
            "pqkds": [{"sae_id": "sae-a", "paired_with": "sae-b", "status": "error"}],
            "timestamp_utc": "2026-01-01T00:00:00Z"
        }"#;

        let event: IngestMessage = serde_json::from_str(heartbeat_json).unwrap();
        store.apply_event(event).await;

        let json = store.snapshot_event_json().await.unwrap();
        assert!(json.contains(r#""status":"error""#), "status missing from snapshot JSON: {json}");
    }
}
