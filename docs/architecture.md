# Thule Music — архитектура

Self-hosted музыкальный сервис (по типу Navidrome/Jellyfin): сервер хранит **вашу** библиотеку, клиенты (web, Android, Linux desktop) стримят её. Лицензирование чужого каталога не требуется.

## Ключевые решения

| Тема | Решение | Почему не «как у Spotify» |
|---|---|---|
| Архитектура | Модульный монолит (FastAPI) + отдельный воркер | Микросервисы и Kubernetes оправданы при тысячах инженеров. Модули с чёткими границами можно вынести позже |
| Развёртывание | Docker Compose (`api` + `worker`), внешний Postgres | K8s/ELK/CDN — когда появится реальная нагрузка |
| БД | PostgreSQL 17, SQLAlchemy 2.1 async, Alembic | — |
| Фоновые задачи | Таблица `jobs` + `SELECT … FOR UPDATE SKIP LOCKED` | Без Redis/брокера; ретраи с экспоненциальной задержкой, дедупликация |
| Стриминг | HTTP Range по файлам: оригинал + Opus 160k/96k (ffmpeg) | WebSocket не нужен для аудио по запросу, Icecast/Wowza — для live-радио. HLS — позже при необходимости |
| Auth | Свой JWT: access (15 мин) + refresh с ротацией и детекцией повторного использования, argon2 | OIDC (Keycloak/Authentik) можно добавить отдельным способом входа |
| Поиск | `ILIKE` + `pg_trgm` (`word_similarity`) — устойчив к опечаткам | Elasticsearch избыточен для личной библиотеки |
| Тексты | sidecar `.lrc`/`.txt` → тег в файле → LRCLIB; кешируются в БД | Genius/Musixmatch не отдают тексты бесплатно |

## Модули бэкенда (`backend/app`)

```
auth/       пользователи, JWT, refresh-токены; первый зарегистрированный = admin
library/    модели каталога, чтение тегов (mutagen), обложки (Pillow), сканер/импорт, REST каталога
media/      стриминг (Range), подписанные URL, перекодирование ffmpeg, выдача обложек
lyrics/     LRC-парсер, поиск текстов, REST
playlists/  CRUD плейлистов, вставка/перемещение/удаление элементов
me/         лайки (виртуальный плейлист «Liked Music»), история прослушиваний
home/       агрегаты главной: New Releases, Recently played, For You
search/     поиск по артистам/альбомам/трекам
jobs/       очередь, воркер (`python -m app.jobs.worker`)
```

### Модель данных

`users`, `refresh_tokens` · `artists` (уникальны по нормализованному имени) · `albums` (уникальны по артисту+названию) · `tracks` (идентичность — путь относительно библиотеки) · `track_files` (перекодированные варианты) · `covers` (дедупликация по sha256, средний цвет для тонировки UI) · `lyrics` · `playlists`, `playlist_items` · `track_likes`, `play_events` · `jobs`.

### Конвейер импорта

```
POST /library/scan или /library/uploads
  └─ scan_library: обход папки, сравнение size/mtime с БД, удаление исчезнувших
       └─ import_track (на каждый новый/изменённый файл)
            ├─ теги → upsert artist / album / track
            ├─ обложка: встроенная или cover.jpg/folder.png рядом → миниатюры 64/300/600
            ├─ transcode: Opus 160k (high) и 96k (low)
            └─ fetch_lyrics: .lrc → тег → LRCLIB (или кеш «нет текста»)
```

### Стриминг

- `GET /tracks/{id}/stream?quality=original|high|low` — с заголовком `Authorization` или с подписью.
- `GET /tracks/{id}/stream-url` выдаёт подписанный URL (HMAC, 6 часов) — для `<audio src>` и ExoPlayer. URL **привязан к уже существующему варианту файла**: если перекодирование ещё не готово, отдаётся оригинал. Иначе Range-запросы посреди трека начали бы читать другой файл.
- Обложки `GET /covers/{id}?size=` — публичные (UUID неугадываем), `Cache-Control: immutable`.

## API

Префикс `/api/v1`, интерактивная документация — `/docs`, схема — `/openapi.json`. OpenAPI — контракт для web-клиента (генерация TS-типов) и KMP-клиента.

## Клиенты (следующие фазы)

**Web (фаза 2):** React + Vite + TypeScript, TanStack Query, типы из OpenAPI, CSS `backdrop-filter` для стекла, `<audio>` + Media Session API.

**Android + Linux (фаза 3):** Kotlin Multiplatform + Compose Multiplatform, Ktor-клиент, blur — Haze. Android: Media3/ExoPlayer + `MediaSessionService`. Linux: VLCJ или GStreamer (выбрать прототипом), MPRIS через D-Bus.

### Дизайн

Минимализм + glassmorphism по референсу. Поправки:
- вторичный текст на стекле — проверять контраст WCAG AA (≥ 4.5:1);
- на Linux — без macOS-кнопок окна;
- мобильный лэйаут отдельный: нижняя навигация, полноэкранный плеер;
- размытие: Android < 12 и GNOME не умеют системный blur — размываем обложку внутри приложения;
- `cover_color` из API — для тонировки фона под текущий трек.

## Риски

- **Задержка до БД.** Postgres доступен по сети (~80 мс на запрос, ~1,3 с на новое соединение). Пул соединений обязателен; API лучше разворачивать рядом с БД.
- **Аудио на Linux в JVM** не работает «из коробки» — нужен прототип.
- **Большая библиотека** долго перекодируется. Оригинал доступен сразу, варианты появляются по мере обработки очереди.
