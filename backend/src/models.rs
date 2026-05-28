use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum IngestMessage {
    #[serde(rename = "pqkd-relay.register")]
    Register(RelayRegister),
    #[serde(rename = "pqkd-relay.heartbeat")]
    Heartbeat(RelayHeartbeat),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TopologyEdge {
    pub first: String,
    pub second: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RelayRegister {
    pub network_id: String,
    pub relay_id: String,
    pub pqkds: Vec<PqkdBinding>,
    #[serde(default)]
    pub connections: Vec<TopologyEdge>,
    pub timestamp_utc: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RelayHeartbeat {
    pub network_id: String,
    pub relay_id: String,
    pub pqkds: Vec<PqkdBinding>,
    pub timestamp_utc: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PqkdBinding {
    pub sae_id: String,
    pub paired_with: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RelayStatus {
    Online,
    Stale,
    Offline,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelayView {
    pub network_id: String,
    pub relay_id: String,
    pub pqkds: Vec<PqkdBinding>,
    pub status: RelayStatus,
    pub first_seen_utc: DateTime<Utc>,
    pub last_seen_utc: DateTime<Utc>,
    pub last_client_timestamp_utc: DateTime<Utc>,
    pub event_count: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetworkView {
    pub network_id: String,
    pub relays: Vec<RelayView>,
    pub connections: Vec<TopologyEdge>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetworksSnapshot {
    pub generated_at_utc: DateTime<Utc>,
    pub networks: Vec<NetworkView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum StreamEvent {
    #[serde(rename = "state.snapshot")]
    Snapshot {
        generated_at_utc: DateTime<Utc>,
        networks: Vec<NetworkView>,
    },
    #[serde(rename = "state.delta")]
    Delta {
        generated_at_utc: DateTime<Utc>,
        relay: RelayView,
    },
}
