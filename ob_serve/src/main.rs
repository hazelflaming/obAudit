mod heatmap;
mod types;

use axum::{
    extract::Request,
    middleware::{self, Next},
    response::Response,
    routing::get,
    Router,
};
use http::header::{AUTHORIZATION, CONTENT_TYPE};
use http::HeaderValue;
use tower_http::cors::CorsLayer;

async fn log_requests(request: Request, next: Next) -> Response {
    println!("{} {}", request.method(), request.uri());
    next.run(request).await
}

#[tokio::main]
async fn main() {
    let cors = CorsLayer::new()
        .allow_origin("http://localhost:5173".parse::<HeaderValue>().unwrap())
        .allow_methods([http::Method::GET, http::Method::POST])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE]);

    let app = Router::new()
        .route("/heatmap", get(heatmap::heatmap_get).post(heatmap::heatmap_post))
        .layer(middleware::from_fn(log_requests))
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    println!("Listening on :3001");
    axum::serve(listener, app).await.unwrap();
}
