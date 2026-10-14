# Разработка

Как запустить сервер и web-клиент для разработки и как гонять проверки. Установка на сервер — в [deploy.md](deploy.md), устройство — в [architecture.md](architecture.md), план — в [roadmap.md](roadmap.md).

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

Образ собирается из корня репозитория (`Dockerfile`): веб-клиент, сервер с зависимостями из `uv.lock`, ffmpeg. Команды внутри — `thule serve`, `thule worker` и `thule migrate`. Подробности — в [deploy.md](deploy.md).

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

Каждый прогон начинается с пустой базы. Сначала идут тесты первого запуска, затем создание админа и скан, затем остальные тесты. Тесты администрирования идут строго по порядку (`serial`): каждый опирается на то, что сделал предыдущий, и после первого упавшего остальные пропускаются, а не падают за него. Тест может ждать воркер, поэтому таймаут — 90 секунд. Повторов нет: тесты делят одну базу, и повтор начинался бы с того, что оставила неудачная попытка.

Схемы `thule_test` (pytest) и `thule_e2e`, как и порт 8100, общие для всех прогонов на одной базе: два одновременных прогона одного набора мешают друг другу. Для параллельного прогона из другой копии репозитория задайте другую схему: `THULE_TEST_SCHEMA` для pytest, `THULE_E2E_SCHEMA` и `THULE_E2E_PORT` для E2E. Логи бэкенда лежат в `web/.e2e/logs/`, отчёт открывается командой `npx playwright show-report`. Playwright закреплён на версии 1.56.1, под Chromium облачного окружения. Локально браузер нужно один раз поставить: `npx playwright install chromium`.

Новые пакеты добавляйте через npm ≥ 11 (`npx npm@11 install …`): npm 10 падает на разборе зависимостей vitest 4. `npm ci` и `npm install` по готовому lock-файлу работают и на npm 10.

## Облачные сессии Claude Code

Скрипт настройки окружения и переменные — в [scripts/cloud/](../scripts/cloud/README.md).
