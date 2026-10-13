# thule-music

Self-hosted музыкальный сервис: сервер для вашей библиотеки + клиенты (web, Android, Linux). Архитектура и решения — в [docs/architecture.md](docs/architecture.md).

Статус: **бэкенд (фаза 1) готов**; web-UI и KMP-приложения — впереди.

## Бэкенд

Требуется Python ≥ 3.12, ffmpeg, PostgreSQL ≥ 13 (с правом создать расширение `pg_trgm`).

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e . pytest pytest-asyncio ruff mypy
cp .env.example .env   # пропишите THULE_DATABASE_URL и THULE_SECRET_KEY
.venv/bin/alembic upgrade head
```

Запуск (два процесса — API и воркер фоновых задач):

```bash
.venv/bin/uvicorn app.main:app --reload
```

```bash
.venv/bin/python -m app.jobs.worker
```

Первый шаг: `POST /api/v1/auth/register` создаёт администратора (только первый пользователь; дальше аккаунты создаёт админ). Затем положите музыку в `THULE_LIBRARY_PATH` и вызовите `POST /api/v1/library/scan`. Документация API — http://localhost:8000/docs.

### Тесты

Тесты используют базу из `.env`, но в отдельной схеме `thule_test` — она пересоздаётся на каждом прогоне.

```bash
.venv/bin/pytest -q
```

### Docker

`docker compose up -d --build` поднимает `api` и `worker` и берёт настройки из `backend/.env`. Папка с музыкой задаётся переменной `MUSIC_LIBRARY` (по умолчанию `./library`).
