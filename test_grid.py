#!/usr/bin/env python3
"""
Symulacja sieci 3×5 relay'ów (Python 3.10, bez zewn. bibliotek).

Topologia (ROWS=3, COLS=5):
  relay-A1 - relay-A2 - relay-A3 - relay-A4 - relay-A5
      |           |           |           |           |
  relay-B1 - relay-B2 - relay-B3 - relay-B4 - relay-B5
      |           |           |           |           |
  relay-C1 - relay-C2 - relay-C3 - relay-C4 - relay-C5

Konwencja SAE ID: "<skrót-relay>-<skrót-sąsiada>"
Np. relay-A1 ↔ relay-A2: sae_id="A1-A2" / paired_with="A2-A1"
"""

import json
import os
import socket
import struct
import threading
import time

HOST       = "localhost"
PORT       = 8080
INTERVAL   = 8
NETWORK_ID = "net-grid-alpha"

ROWS = 3
COLS = 5
ROW_LABELS = "ABCDEFGH"


def relay_name(row: int, col: int) -> str:
    return f"relay-{ROW_LABELS[row]}{col + 1}"


def sae_short(relay: str) -> str:
    """relay-A1 → A1"""
    return relay.replace("relay-", "")


def build_topology() -> dict[str, list]:
    nodes: dict[str, list] = {}
    for r in range(ROWS):
        for c in range(COLS):
            rid = relay_name(r, c)
            me  = sae_short(rid)
            pqkds = []
            for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nr, nc = r + dr, c + dc
                if 0 <= nr < ROWS and 0 <= nc < COLS:
                    nbr = sae_short(relay_name(nr, nc))
                    pqkds.append({
                        "sae_id":      f"{me}-{nbr}",
                        "paired_with": f"{nbr}-{me}",
                    })
            nodes[rid] = pqkds
    return nodes


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


def make_msg(msg_type: str, relay_id: str, pqkds: list) -> str:
    return json.dumps({
        "type":          msg_type,
        "network_id":    NETWORK_ID,
        "relay_id":      relay_id,
        "pqkds":         pqkds,
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


def relay_loop(relay_id: str, pqkds: list):
    while True:
        try:
            s = ws_connect()
            ws_send(s, make_msg("pqkd-relay.register", relay_id, pqkds))
            print(f"[{relay_id}] connected ({len(pqkds)} links)")
            while True:
                time.sleep(INTERVAL)
                ws_send(s, make_msg("pqkd-relay.heartbeat", relay_id, pqkds))
        except Exception as e:
            print(f"[{relay_id}] error: {e}, retry in 3s")
            time.sleep(3)


if __name__ == "__main__":
    nodes = build_topology()
    print(f"Topology: {ROWS}×{COLS} = {len(nodes)} relays, network={NETWORK_ID!r}\n")

    for relay_id, pqkds in nodes.items():
        t = threading.Thread(target=relay_loop, args=(relay_id, pqkds), daemon=True)
        t.start()
        time.sleep(0.05)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopped.")
