"""The worker's sign of life, for Docker's health check (`thule health worker`): a file the
worker touches while it reaches the database. Apart from the worker, so the check is quick."""

import tempfile
from datetime import timedelta
from pathlib import Path

ALIVE_FILE = Path(tempfile.gettempdir()) / "thule-worker.alive"
# How often the worker touches it.
ALIVE_EVERY = timedelta(seconds=30)
# Older than this, the worker is unhealthy.
ALIVE_AFTER = timedelta(minutes=2)
