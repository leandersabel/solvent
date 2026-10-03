"""The one way in from the runner to the app
(spec/features/nightly-harness.md, The relay).

A port cannot be published from an internal network, so this copies
bytes both ways between each accepted connection and one new connection
to a fixed target, and closes both when either side closes. It reads,
logs and alters nothing.

    python relay.py --listen 0.0.0.0:8000 --to solvent:8000
"""
from __future__ import annotations

import argparse
import signal
import socket
import sys
import threading

CHUNK = 64 * 1024
CONNECT_TIMEOUT_SECONDS = 10


def address(text: str) -> "tuple[str, int]":
    host, _, port = text.rpartition(":")
    if not host or not port.isdigit():
        raise argparse.ArgumentTypeError(f"not host:port: {text}")
    return host, int(port)


def close(*sockets: socket.socket) -> None:
    for each in sockets:
        try:
            each.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        each.close()


def pump(source: socket.socket, sink: socket.socket) -> None:
    """Copy until either side closes, then close both."""
    try:
        while chunk := source.recv(CHUNK):
            sink.sendall(chunk)
    except OSError:
        pass
    finally:
        close(source, sink)


def serve(client: socket.socket, target: "tuple[str, int]") -> None:
    try:
        upstream = socket.create_connection(target, timeout=CONNECT_TIMEOUT_SECONDS)
    except OSError:
        close(client)
        return
    upstream.settimeout(None)
    threading.Thread(target=pump, args=(upstream, client), daemon=True).start()
    pump(client, upstream)


def relay(listener: socket.socket, target: "tuple[str, int]") -> None:
    while True:
        client, _ = listener.accept()
        threading.Thread(target=serve, args=(client, target), daemon=True).start()


def main(argv: "list[str]") -> int:
    parser = argparse.ArgumentParser(prog="relay.py")
    parser.add_argument("--listen", required=True, type=address)
    parser.add_argument("--to", required=True, type=address)
    try:
        args = parser.parse_args(argv[1:])
    except SystemExit:
        return 2
    listener = socket.create_server(args.listen)
    # PID 1 in a container ignores SIGTERM unless it has a handler.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    relay(listener, args.to)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
