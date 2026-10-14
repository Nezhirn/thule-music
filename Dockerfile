# Thule Music: the server and its web app in one image, run as two processes:
#   thule serve    the API and the web app, on port 8000
#   thule worker   background jobs: imports, transcodes, lyrics
# docker-compose.yml runs both.

# The web app, built, with compressed copies of its files.
FROM node:22-slim AS web
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npx vite build

# The server's packages, exactly as locked in uv.lock.
FROM python:3.13-slim AS server
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
RUN uv sync --frozen --no-dev

FROM python:3.13-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=server /opt/venv /opt/venv
COPY --from=server /app /app
COPY --from=web /web/dist /app/web
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
ENV PATH=/opt/venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    THULE_LIBRARY_PATH=/library THULE_DATA_PATH=/data THULE_WEB_PATH=/app/web \
    PUID=1000 PGID=1000
WORKDIR /app
EXPOSE 8000
# The server answering its /health (which asks the database), or the worker reaching the
# database: `docker ps` says "unhealthy" for a server that hangs. The role is told by the
# container's command. Start-up migrates the database first: failures then don't count.
HEALTHCHECK --interval=30s --timeout=15s --start-period=2m --retries=3 \
    CMD ["python", "-m", "app.health"]
ENTRYPOINT ["entrypoint"]
CMD ["thule", "serve"]
