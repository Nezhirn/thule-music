"""Whether this container's process works, for Docker's HEALTHCHECK:

    python -m app.health [server|worker] [--port 8000]

(`thule health` too, slower to start.) Exits 0 if it does, 1 with the reason on standard
error if not. Imports next to nothing: Docker runs it every half minute."""

import argparse
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from app.jobs.alive import ALIVE_AFTER, ALIVE_FILE

# The server answering its health check (which asks the database) within this long, seconds.
TIMEOUT_SECONDS = 10


def health(role: str | None, port: int = 8000) -> int:
    """Whether the server answers (its /health asks the database), or the worker reaches the
    database (see app.jobs.alive). Without a role, the one this container runs: its first
    process's command."""
    if role is None:
        try:
            first = Path("/proc/1/cmdline").read_bytes().split(b"\0")
        except OSError:
            first = []
        role = "worker" if b"worker" in first else "server"
    if role == "worker":
        try:
            age = time.time() - ALIVE_FILE.stat().st_mtime
        except FileNotFoundError:
            print("The worker hasn't reached the database yet", file=sys.stderr)
            return 1
        if age > ALIVE_AFTER.total_seconds():
            print(f"The worker hasn't reached the database for {age:.0f} s", file=sys.stderr)
            return 1
        return 0
    url = f"http://127.0.0.1:{port}/api/v1/health"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:
            response.read()
        return 0
    except urllib.error.HTTPError as exc:
        print(f"{url}: {exc.code} {exc.reason}", file=sys.stderr)
    except (OSError, TimeoutError) as exc:
        print(f"{url}: {getattr(exc, 'reason', exc)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog="python -m app.health")
    parser.add_argument("role", nargs="?", choices=["server", "worker"])
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    raise SystemExit(health(args.role, args.port))
