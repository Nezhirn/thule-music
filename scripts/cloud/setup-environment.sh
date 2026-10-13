#!/bin/bash
# thule-music — setup script for a Claude Code cloud environment.
# Paste this into the environment's "Setup script" field (claude.ai/code → environment settings).
#
# Runs as root on Ubuntu 24.04 before Claude Code starts. The resulting filesystem is cached
# (~7 days), so it must stay under ~5 minutes and must exit 0. Per-session work (starting
# Postgres, installing Python deps, migrations) lives in scripts/cloud/session-start.sh.
#
# Why a local Postgres: the project's real database sits on a private Tailscale address
# that cloud VMs can't reach, so cloud sessions use the preinstalled PostgreSQL 16 instead.

set -uo pipefail
export DEBIAN_FRONTEND=noninteractive

# ffmpeg: transcoding + test fixtures. Not in the base image.
apt-get update -qq || true
apt-get install -y -qq --no-install-recommends ffmpeg postgresql-contrib >/dev/null \
  || echo "WARN: apt install failed — transcode tests will fail until ffmpeg is installed"

# Local database: role `thule` / password `thule`, database `thule` with pg_trgm.
# Data files are on disk, so the role and database survive in the cached snapshot.
service postgresql start
for _ in $(seq 1 30); do pg_isready -q && break; sleep 1; done

su postgres -c "psql -q -v ON_ERROR_STOP=1" <<'SQL' || echo "WARN: role setup failed"
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'thule') THEN
    CREATE ROLE thule LOGIN PASSWORD 'thule';
  END IF;
END
$$;
SQL
su postgres -c "createdb -O thule thule" 2>/dev/null || true
su postgres -c "psql -q -d thule -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm'" \
  || echo "WARN: pg_trgm not created (migrations will try again)"

# The cache keeps files, not processes; the SessionStart hook starts Postgres each session.
service postgresql stop || true
exit 0
