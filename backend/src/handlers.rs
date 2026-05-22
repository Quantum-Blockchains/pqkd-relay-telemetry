use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
    Json,
};
use futures_util::StreamExt;
use tracing::{error, info, warn};

use crate::{
    models::{IngestMessage, NetworksSnapshot},
    state::AppState,
};

pub async fn healthz() -> &'static str {
    "ok"
}

pub async fn get_networks(State(state): State<AppState>) -> Json<NetworksSnapshot> {
    Json(state.store.snapshot().await)
}

pub async fn ingest_ws(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ingest(socket, state))
}

pub async fn stream_ws(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_stream(socket, state))
}

async fn handle_ingest(mut socket: WebSocket, state: AppState) {
    let mut is_registered = false;
    while let Some(next) = socket.next().await {
        match next {
            Ok(Message::Text(text)) => {
                let raw = text.to_string();
                let parsed = match serde_json::from_str::<IngestMessage>(&raw) {
                    Ok(message) => message,
                    Err(err) => {
                        warn!("invalid ingest json: {err}");
                        break;
                    }
                };

                if !is_registered {
                    if !matches!(parsed, IngestMessage::Register(_)) {
                        warn!("first ingest message must be pqkd-relay.register");
                        break;
                    }
                    is_registered = true;
                    info!("relay registered");
                }

                println!("{raw}");
                state.store.apply_event(parsed).await;
            }
            Ok(Message::Binary(_)) => {
                warn!("binary ingest payload ignored");
                break;
            }
            Ok(Message::Close(_)) => break,
            Ok(Message::Ping(payload)) => {
                if let Err(err) = socket.send(Message::Pong(payload)).await {
                    warn!("failed to send pong: {err}");
                    break;
                }
            }
            Ok(Message::Pong(_)) => {}
            Err(err) => {
                error!("ingest websocket error: {err}");
                break;
            }
        }
    }
}

async fn handle_stream(mut socket: WebSocket, state: AppState) {
    match state.store.snapshot_event_json().await {
        Ok(snapshot) => {
            if let Err(err) = socket.send(Message::Text(snapshot.into())).await {
                warn!("failed to send initial snapshot: {err}");
                return;
            }
        }
        Err(err) => {
            warn!("failed to serialize snapshot: {err}");
            return;
        }
    }

    let mut rx = state.store.subscribe();
    loop {
        match rx.recv().await {
            Ok(message) => {
                if let Err(err) = socket.send(Message::Text(message.into())).await {
                    warn!("stream client disconnected: {err}");
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                warn!("stream subscriber lagged and skipped {skipped} events");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}
