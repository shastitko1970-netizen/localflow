use crate::state::SharedState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;

pub async fn serve_mcp(state: SharedState, port: u16) {
    let app = Router::new()
        .route("/health", get(health))
        .route("/mcp", post(mcp_rpc))
        .route("/api/status", get(api_status))
        .route("/api/dictations", get(api_list_dictations))
        .route("/api/dictations/{id}", get(api_get_dictation))
        .route("/api/dictations/search", get(api_search))
        .route("/api/meetings", get(api_list_meetings))
        .route("/api/meetings/{id}", get(api_get_meeting))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("LocalFlow MCP/HTTP listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind mcp");
    axum::serve(listener, app).await.expect("mcp serve");
}

async fn health() -> impl IntoResponse {
    Json(json!({"ok": true, "name": "LocalFlow", "version": env!("CARGO_PKG_VERSION")}))
}

async fn api_status(State(state): State<SharedState>) -> impl IntoResponse {
    Json(state.status())
}

#[derive(Deserialize)]
struct LimitQuery {
    limit: Option<usize>,
    q: Option<String>,
}

async fn api_list_dictations(
    State(state): State<SharedState>,
    Query(q): Query<LimitQuery>,
) -> impl IntoResponse {
    match state.history.list(q.limit.unwrap_or(50)) {
        Ok(items) => (StatusCode::OK, Json(json!(items))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn api_get_dictation(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.history.get(&id) {
        Ok(Some(item)) => (StatusCode::OK, Json(json!(item))).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn api_search(
    State(state): State<SharedState>,
    Query(q): Query<LimitQuery>,
) -> impl IntoResponse {
    let query = q.q.unwrap_or_default();
    match state.history.search(&query, q.limit.unwrap_or(50)) {
        Ok(items) => (StatusCode::OK, Json(json!(items))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn api_list_meetings(
    State(state): State<SharedState>,
    Query(q): Query<LimitQuery>,
) -> impl IntoResponse {
    match state.history.list_meetings(q.limit.unwrap_or(50)) {
        Ok(items) => (StatusCode::OK, Json(json!(items))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn api_get_meeting(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.history.get_meeting(&id) {
        Ok(Some(item)) => (StatusCode::OK, Json(json!(item))).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

/// Minimal JSON-RPC style MCP tool dispatch for agent clients.
async fn mcp_rpc(State(state): State<SharedState>, Json(body): Json<Value>) -> impl IntoResponse {
    let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = body.get("id").cloned().unwrap_or(json!(1));
    let params = body.get("params").cloned().unwrap_or(json!({}));

    let result = match method {
        "initialize" => json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "localflow", "version": env!("CARGO_PKG_VERSION")}
        }),
        "tools/list" => json!({
            "tools": [
                {"name": "list_dictations", "description": "List recent dictations", "inputSchema": {"type":"object","properties":{"limit":{"type":"number"}}}},
                {"name": "get_dictation", "description": "Get dictation by id", "inputSchema": {"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}},
                {"name": "search_dictations", "description": "Search dictation text", "inputSchema": {"type":"object","properties":{"q":{"type":"string"},"limit":{"type":"number"}},"required":["q"]}},
                {"name": "get_status", "description": "Runtime status", "inputSchema": {"type":"object","properties":{}}},
                {"name": "list_meetings", "description": "List meetings", "inputSchema": {"type":"object","properties":{"limit":{"type":"number"}}}},
                {"name": "get_meeting", "description": "Get meeting by id", "inputSchema": {"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}}
            ]
        }),
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let content = match name {
                "list_dictations" => {
                    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                    json!(state.history.list(limit).unwrap_or_default())
                }
                "get_dictation" => {
                    let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    json!(state.history.get(id).ok().flatten())
                }
                "search_dictations" => {
                    let q = args.get("q").and_then(|v| v.as_str()).unwrap_or("");
                    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                    json!(state.history.search(q, limit).unwrap_or_default())
                }
                "get_status" => json!(state.status()),
                "list_meetings" => {
                    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                    json!(state.history.list_meetings(limit).unwrap_or_default())
                }
                "get_meeting" => {
                    let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    json!(state.history.get_meeting(id).ok().flatten())
                }
                _ => json!({"error": format!("unknown tool {name}")}),
            };
            json!({
                "content": [{"type":"text","text": serde_json::to_string_pretty(&content).unwrap_or_default()}],
                "isError": false
            })
        }
        "ping" => json!({}),
        _ => {
            return Json(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": -32601, "message": format!("Method not found: {method}")}
            }))
            .into_response();
        }
    };

    Json(json!({"jsonrpc":"2.0","id": id, "result": result})).into_response()
}
