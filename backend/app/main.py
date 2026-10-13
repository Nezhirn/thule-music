from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.auth.router import router as auth_router
from app.auth.router import users_router
from app.config import Settings, get_settings
from app.db import make_engine, make_sessionmaker
from app.deps import SessionDep
from app.errors import ERROR_RESPONSES, install_error_handlers
from app.home.router import router as home_router
from app.library.admin import admin_router as library_admin_router
from app.library.edits import edits_router
from app.library.router import router as library_router
from app.lyrics.router import router as lyrics_router
from app.me.router import router as me_router
from app.media.router import router as media_router
from app.playlists.router import router as playlists_router
from app.search.router import router as search_router
from app.web import WebApp

API_ROOT = "/api"
API_PREFIX = f"{API_ROOT}/v1"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = make_engine(settings.database_url, settings.db_schema, pool_pre_ping=True)
        app.state.engine = engine
        app.state.sessionmaker = make_sessionmaker(engine)
        yield
        await engine.dispose()

    app = FastAPI(
        title="Thule Music",
        version="0.1.0",
        lifespan=lifespan,
        # operationId = the endpoint function's name ("list_albums"), for generated clients.
        generate_unique_id_function=lambda route: route.name,
        # Under /api with the rest of the server: every other path is the web app's.
        docs_url=f"{API_ROOT}/docs",
        redoc_url=None,
        openapi_url=f"{API_ROOT}/openapi.json",
    )
    app.state.settings = settings
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Range", "Accept-Ranges", "X-Thule-Quality"],
    )

    api = APIRouter(prefix=API_PREFIX, responses=ERROR_RESPONSES)
    for router in (
        auth_router,
        users_router,
        library_router,
        library_admin_router,
        edits_router,
        media_router,
        lyrics_router,
        playlists_router,
        me_router,
        home_router,
        search_router,
    ):
        api.include_router(router)

    @api.get("/health", tags=["meta"])
    async def health(session: SessionDep) -> dict[str, str]:
        await session.execute(text("SELECT 1"))
        return {"status": "ok"}

    app.include_router(api)
    if settings.web_path is not None:
        app.router.default = WebApp(settings.web_path)
    return app


app = create_app()
