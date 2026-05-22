use std::net::SocketAddr;
use std::sync::Arc;
use tokio::{sync::broadcast, time::Duration};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::info;

mod handlers;
mod models;
mod state;

use axum::{Router, routing::get};
use handlers::{get_networks, healthz, ingest_ws, stream_ws};
use state::{AppState, TelemetryStore};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "telemetry_backend=info,tower_http=info".to_string()),
        )
        .init();

    let (stream_tx, _) = broadcast::channel::<String>(4096);
    let store = Arc::new(TelemetryStore::new(stream_tx));
    let state = AppState {
        store: Arc::clone(&store),
    };

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            store.refresh_statuses().await;
        }
    });

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/networks", get(get_networks))
        .route("/ingest", get(ingest_ws))
        .route("/stream", get(stream_ws))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind listener");

    info!("telemetry backend listening on ws://0.0.0.0:8080");
    axum::serve(listener, app)
        .await
        .expect("failed to run axum server");
}
