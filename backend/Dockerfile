FROM rust:1.88-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/telemetry-backend /usr/local/bin/telemetry-backend

EXPOSE 8080

ENV RUST_LOG=telemetry_backend=info,tower_http=info

CMD ["/usr/local/bin/telemetry-backend"]
