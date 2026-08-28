import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from .api import acs, auth, bindings, dashboard, devices, downs, fiber, fiber_approvals, map, noc_pop, onus, reports, search, subscribers, tickets, users
from .config import get_settings
from .database import SessionLocal, init_db
from .models import User
from .security import hash_password
from .services.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("olt_commander")


async def _seed_admin() -> None:
    async with SessionLocal() as session:
        exists = (await session.execute(select(User).limit(1))).scalar_one_or_none()
        if exists is None:
            settings = get_settings()
            session.add(
                User(
                    username=settings.admin_username,
                    password_hash=hash_password(settings.admin_password),
                    is_admin=True,
                )
            )
            await session.commit()
            logger.info("Created default admin user '%s'", settings.admin_username)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _seed_admin()
    scheduler = start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="OLT Commander", version="0.1.0", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(onus.router)
app.include_router(bindings.router)
app.include_router(dashboard.router)
app.include_router(search.router)
app.include_router(subscribers.router)
app.include_router(downs.router)
app.include_router(map.router)
app.include_router(users.router)
app.include_router(reports.router)
app.include_router(tickets.router)
app.include_router(acs.router)
app.include_router(fiber.router)
app.include_router(fiber_approvals.router)
app.include_router(noc_pop.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}