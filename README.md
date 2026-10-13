# thule-music

Self-hosted музыкальный сервис: сервер для вашей библиотеки + клиенты (web, Android, Linux). Архитектура и решения — в [docs/architecture.md](docs/architecture.md).

Статус: **сервер и web-клиент готовы**, KMP-приложения — впереди. План — в [docs/roadmap.md](docs/roadmap.md).

## Установка

Один Docker-образ: сервер вместе с web-клиентом.

```bash
cp .env.example .env   # THULE_SECRET_KEY, POSTGRES_PASSWORD, MUSIC_LIBRARY, PUID/PGID
docker compose --profile local-db up -d --build
```

Приложение откроется на http://localhost:8000, при первом входе создаётся администратор. Как подключить свой Postgres, настроить HTTPS за обратным прокси, обновляться и делать резервные копии — в [docs/deploy.md](docs/deploy.md).

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

Первый шаг: `POST /api/v1/auth/register` создаёт администратора (только первый пользователь; дальше аккаунты создаёт админ). Затем положите музыку в `THULE_LIBRARY_PATH` и вызовите `POST /api/v1/library/scan`. Документация API — http://localhost:8000/api/docs.

### Тесты

Тесты используют базу из `.env`, но в отдельной схеме `thule_test` — она пересоздаётся на каждом прогоне.

```bash
.venv/bin/pytest -q
```

### Docker

Образ собирается из корня репозитория (`Dockerfile`): веб-клиент, сервер с зависимостями из `uv.lock`, ffmpeg. Команды внутри — `thule serve`, `thule worker` и `thule migrate`. Подробности — в [docs/deploy.md](docs/deploy.md).

## Web-клиент

Требуется Node.js ≥ 22.12 и npm. Нужен запущенный бэкенд (API + воркер): dev-сервер проксирует `/api` на `http://127.0.0.1:8000`, другой адрес задаётся в `THULE_API_URL`.

```bash
cd web
npm ci
npm run dev   # http://localhost:5173
```

`npm run build` собирает приложение в `web/dist` (вместе со сжатыми brotli и gzip копиями файлов). Сервер раздаёт сборку сам, если указать её в `THULE_WEB_PATH`.

Типы API генерируются из OpenAPI бэкенда. После изменений в API выполните `npm run api:types`. Скрипт запускает Python из `backend/.venv`, другой путь задаётся в `THULE_PYTHON`.

### Проверки

| Команда | Что делает |
|---|---|
| `npm run check` | актуальность типов API, ESLint + Prettier, TypeScript, юнит-тесты (Vitest + MSW) |
| `npm run e2e` | Playwright против настоящего бэкенда, с проверкой доступности (axe-core) |
| `npm run verify` | всё вместе |

E2E-стенд поднимается сам (`web/e2e/stack/`):
- пересоздаёт схему `thule_e2e` в базе из `backend/.env`;
- генерирует ffmpeg'ом библиотеку по `e2e/stack/library.json`;
- собирает фронт;
- запускает на порту 8100 API, который раздаёт эту сборку, как в продакшне, и воркер.

Тест падает, если страница нарушила Content Security Policy сервера.

Каждый прогон начинается с пустой базы. Сначала идут тесты первого запуска, затем создание админа и скан, затем остальные тесты. Логи бэкенда лежат в `web/.e2e/logs/`, отчёт открывается командой `npx playwright show-report`. Playwright закреплён на версии 1.56.1, под Chromium облачного окружения. Локально браузер нужно один раз поставить: `npx playwright install chromium`.

Новые пакеты добавляйте через npm ≥ 11 (`npx npm@11 install …`): npm 10 падает на разборе зависимостей vitest 4. `npm ci` и `npm install` по готовому lock-файлу работают и на npm 10.

## Облачные сессии Claude Code

Скрипт настройки окружения и переменные — в [scripts/cloud/](scripts/cloud/README.md).
