# Облачные сессии Claude Code

Настройка окружения на [claude.ai/code](https://claude.ai/code) (диалог окружения):

| Поле | Что указать |
|---|---|
| Network access | **Trusted** (PyPI и репозитории Ubuntu уже в списке) |
| Environment variables | содержимое [`environment.env`](environment.env) |
| Setup script | содержимое [`setup-environment.sh`](setup-environment.sh) |

Хук SessionStart из `.claude/settings.json` запускает [`session-start.sh`](session-start.sh) при каждом старте сессии: поднимает локальный Postgres, создаёт в нём роль и базу `thule` (если их нет), выполняет `uv sync` и `alembic upgrade head`, ставит npm-зависимости web-клиента (`npm ci`). Вне облака (`CLAUDE_CODE_REMOTE` ≠ `true`) хук ничего не делает.

В облаке используется **локальный PostgreSQL 16 внутри VM**, а не боевая база: она в сети Tailscale и из облака недоступна. Доступы к ней в облако не передаются.
