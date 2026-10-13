#!/bin/bash
# SessionStart hook (see .claude/settings.json): readies the backend in Claude Code cloud
# sessions — starts the VM-local Postgres, installs Python deps, applies migrations.
# Does nothing on local machines.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

set -uo pipefail
BACKEND="${CLAUDE_PROJECT_DIR:-$(pwd)}/backend"
LOG=/tmp/thule-session-start.log
: >"$LOG"

as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@"; fi; }

problems=()

if ! pg_isready -q -h localhost; then
  as_root service postgresql start >>"$LOG" 2>&1
  for _ in $(seq 1 30); do pg_isready -q -h localhost && break; sleep 1; done
fi
pg_isready -q -h localhost || problems+=("postgres not running")

cd "$BACKEND" || exit 0
if command -v uv >/dev/null; then
  uv sync --quiet >>"$LOG" 2>&1 || problems+=("uv sync failed")
else
  { python3 -m venv .venv && .venv/bin/pip install -q -e . pytest pytest-asyncio ruff mypy; } \
    >>"$LOG" 2>&1 || problems+=("pip install failed")
fi

if [ ${#problems[@]} -eq 0 ]; then
  .venv/bin/alembic upgrade head >>"$LOG" 2>&1 || problems+=("alembic upgrade failed")
fi
command -v ffmpeg >/dev/null || problems+=("ffmpeg missing (check the environment setup script)")

# stdout becomes context for Claude, so keep it short.
if [ ${#problems[@]} -eq 0 ]; then
  echo "thule-music cloud setup OK: local Postgres on localhost:5432 (db thule), venv at backend/.venv, migrations applied. Run tests: cd backend && .venv/bin/pytest -q"
else
  echo "thule-music cloud setup had problems: ${problems[*]}. Details: $LOG"
fi
exit 0
