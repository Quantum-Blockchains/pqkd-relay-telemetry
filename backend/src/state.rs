use crate::models::{
    IngestMessage, NetworkView, NetworksSnapshot, PqkdBinding, RelayHeartbeat, RelayRegister, RelayStatus, RelayView,
    StreamEvent,
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
    stream_tx: broadcast::Sender<String>,
}

impl TelemetryStore {
    pub fn new(stream_tx: broadcast::Sender<String>) -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
            stream_tx,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.stream_tx.subscribe()
    }

    pub async fn apply_event(&self, event: IngestMessage) {
        let now = Utc::now();
        let delta = {
            let mut guard = self.inner.write().await;
            let state = match event {
                IngestMessage::Register(payload) => upsert_from_register(&mut guard, payload, now),
                IngestMessage::Heartbeat(payload) => upsert_from_heartbeat(&mut guard, payload, now),
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
            .map(|(network_id, relays)| NetworkView { network_id, relays })
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
        match serde_json::to_string(&event) {
            Ok(payload) => {
                let _ = self.stream_tx.send(payload);
            }
            Err(_) => {}
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
