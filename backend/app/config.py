from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander"

    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    admin_username: str = "admin"
    admin_password: str = "admin123"

    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    scan_olt_interval: int = 900
    scan_mikrotik_interval: int = 300
    bind_interval: int = 300
    telemetry_interval: int = 300
    mac_vendor_sync_interval: int = 86400  # seconds (24h)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()