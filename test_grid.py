#!/usr/bin/env python3
"""
Symulacja 10 relay'ów w topologii 2×5 z przekątnymi (Python 3.10, bez zewn. bibliotek).

Topologia (ROWS=2, COLS=5) — grid + przekątne, bez wrap-around:

  relay-A1 - relay-A2 - relay-A3 - relay-A4 - relay-A5
      | \×/     | \×/     | \×/     | \×/     |
  relay-B1 - relay-B2 - relay-B3 - relay-B4 - relay-B5

Stopnie:
  narożniki (A1, A5, B1, B5): 3 połączenia
  krawędzie (A2-A4, B2-B4):   5 połączeń

Każdy node ma stopień ≥3 → gwarantuje 2 rozłączne wierzchołkowo ścieżki.
Bez krawędzi wrap-around → brak mylących długich linii w widoku siatki.
"""

import json
import os
import socket
import struct
import threading
import time

HOST       = os.environ.get("HOST", "localhost")
PORT       = int(os.environ.get("PORT", "8080"))
INTERVAL   = 8
NETWORK_ID = "net-grid-alpha"

ROWS = 2
COLS = 5
ROW_LABELS = "AB"


def relay_name(row: int, col: int) -> str:
    return f"node-{ROW_LABELS[row]}{col + 1}"


def sae_short(relay: str) -> str:
    return relay.replace("node-", "")


def build_topology() -> tuple[dict[str, list], list[dict]]:
    nodes: dict[str, list] = {}
    edge_set: set[tuple] = set()
    for r in range(ROWS):
        for c in range(COLS):
            rid = relay_name(r, c)
            me  = sae_short(rid)
            pqkds = []
            # Połączenia grid (4 kierunki, bez wrap)
            for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nr, nc = r + dr, c + dc
                if 0 <= nr < ROWS and 0 <= nc < COLS:
                    nbr = sae_short(relay_name(nr, nc))
                    pqkds.append({"sae_id": f"{me}-{nbr}", "paired_with": f"{nbr}-{me}"})
                    edge_set.add(tuple(sorted([rid, relay_name(nr, nc)])))
            # Przekątne (oba kierunki, bez wrap)
            for dr, dc in [(-1, -1), (-1, 1), (1, -1), (1, 1)]:
                nr, nc = r + dr, c + dc
                if 0 <= nr < ROWS and 0 <= nc < COLS:
                    nbr = sae_short(relay_name(nr, nc))
                    pqkds.append({"sae_id": f"{me}-{nbr}", "paired_with": f"{nbr}-{me}"})
                    edge_set.add(tuple(sorted([rid, relay_name(nr, nc)])))
            nodes[rid] = pqkds
    connections = [{"first": a, "second": b} for a, b in sorted(edge_set)]
    return nodes, connections


def ws_connect() -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect((HOST, PORT))
    key = __import__("base64").b64encode(os.urandom(16)).decode()
    req = (
        f"GET /ingest HTTP/1.1\r\n"
        f"Host: {HOST}:{PORT}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(req.encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += s.recv(1024)
    if b"101" not in resp:
        raise ConnectionError(f"WS handshake failed: {resp[:200]}")
    return s


def ws_send(s: socket.socket, text: str):
    payload = text.encode("utf-8")
    n    = len(payload)
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    header = bytes([0x81, 0x80 | n]) + mask if n < 126 else bytes([0x81, 0xFE]) + struct.pack(">H", n) + mask
    s.sendall(header + masked)


def make_msg(msg_type: str, relay_id: str, pqkds: list, connections: list | None = None) -> str:
    payload: dict = {
        "type":          msg_type,
        "network_id":    NETWORK_ID,
        "relay_id":      relay_id,
        "pqkds":         pqkds,
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if connections is not None:
        payload["connections"] = connections
    return json.dumps(payload)


# Relay'e z tej listy wysyłają tylko register, potem milczą → idą offline po ~30s
OFFLINE_RELAYS: set[str] = {"node-A4"}


def relay_loop(relay_id: str, pqkds: list, connections: list):
    offline = relay_id in OFFLINE_RELAYS
    while True:
        try:
            s = ws_connect()
            ws_send(s, make_msg("pqkd-relay.register", relay_id, pqkds, connections))
            print(f"[{relay_id}] connected ({len(pqkds)} links)" + (" [will go offline]" if offline else ""))
            if offline:
                return  # brak heartbeatów → stale po 15s, offline po 30s
            while True:
                time.sleep(INTERVAL)
                ws_send(s, make_msg("pqkd-relay.heartbeat", relay_id, pqkds))
        except Exception as e:
            print(f"[{relay_id}] error: {e}, retry in 3s")
            time.sleep(3)


if __name__ == "__main__":
    nodes, connections = build_topology()
    print(f"Topology: {ROWS}×{COLS} = {len(nodes)} relays, {len(connections)} edges, network={NETWORK_ID!r}")
    for rid, pqkds in nodes.items():
        print(f"  {rid}: degree {len(pqkds)}")
    print()

    for relay_id, pqkds in nodes.items():
        t = threading.Thread(target=relay_loop, args=(relay_id, pqkds, connections), daemon=True)
        t.start()
        time.sleep(0.05)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopped.")
