"""Backup & Restore API router."""
import json
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_db
from ..models import BackupRecord, Setting
from ..security import get_current_user, require_admin
from ..services.backup import (
    DATASETS, create_backup, delete_backup, download_backup, list_backups, restore_backup,
)

router = APIRouter(prefix="/api/backup", tags=["backup"], dependencies=[Depends(get_current_user)])


@router.get("")
async def api_list_backups(db: AsyncSession = Depends(get_db), _user=Depends(require_admin)):
    """List all backup records."""
    return await list_backups(db)


@router.post("")
async def api_create_backup(db: AsyncSession = Depends(get_db), _user=Depends(require_admin)):
    """Create a new backup."""
    result = await create_backup(trigger="manual")
    if result.get("status") == "failed":
        raise HTTPException(status_code=500, detail=result.get("error", "Backup failed"))
    return result


@router.get("/datasets")
async def api_list_datasets(_user=Depends(require_admin)):
    """List available backup datasets."""
    return [
        {"key": k, "label": v["label"], "tables": [t[0] for t in v["tables"]]}
        for k, v in DATASETS.items()
    ]


@router.get("/download/{backup_id}")
async def api_download_backup(backup_id: str, _user=Depends(require_admin)):
    """Download backup as a directory (zipped on-the-fly)."""
    backup_dir = download_backup(backup_id)
    if not backup_dir or not backup_dir.exists():
        raise HTTPException(status_code=404, detail="Backup not found")
    zip_path = shutil.make_archive(
        str(backup_dir.parent / backup_id), "zip", str(backup_dir)
    )
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{backup_id}.zip",
        background=None,
    )


@router.post("/restore/{backup_id}")
async def api_restore_backup(
    backup_id: str,
    datasets: list[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin),
):
    """Restore from a backup. Pass ?datasets=tj_splitter&datasets=users for selective restore."""
    result = await restore_backup(
        backup_id=backup_id,
        datasets=datasets if datasets else None,
        create_safety=True,
    )
    if result.get("status") == "failed":
        raise HTTPException(status_code=500, detail=result.get("error", "Restore failed"))
    return result


@router.delete("/{backup_id}")
async def api_delete_backup(
    backup_id: str,
    cloud: bool = Query(default=False),
    _user=Depends(require_admin),
):
    """Delete a backup."""
    result = await delete_backup(backup_id, cloud=cloud)
    return result


@router.get("/settings")
async def api_get_backup_settings(db: AsyncSession = Depends(get_db), _user=Depends(require_admin)):
    """Get backup-related settings (R2 config)."""
    r2_endpoint = (await db.execute(select(Setting.value).where(Setting.key == "r2_endpoint"))).scalar_one_or_none() or ""
    r2_bucket = (await db.execute(select(Setting.value).where(Setting.key == "r2_bucket_name"))).scalar_one_or_none() or ""
    r2_access_key = (await db.execute(select(Setting.value).where(Setting.key == "r2_access_key_id"))).scalar_one_or_none() or ""
    r2_secret = (await db.execute(select(Setting.value).where(Setting.key == "r2_secret_access_key"))).scalar_one_or_none() or ""
    backup_dir = (await db.execute(select(Setting.value).where(Setting.key == "backup_dir"))).scalar_one_or_none() or ""
    return {
        "r2_endpoint": r2_endpoint,
        "r2_bucket_name": r2_bucket,
        "r2_access_key_id": r2_access_key[:4] + "****" if r2_access_key else "",
        "r2_secret_access_key": "****" if r2_secret else "",
        "backup_dir": backup_dir or "/app/backups",
        "cloud_enabled": bool(r2_endpoint and r2_bucket),
    }


@router.post("/settings")
async def api_update_backup_settings(
    data: dict,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin),
):
    """Update backup settings (R2 config)."""
    for key in ["r2_endpoint", "r2_bucket_name", "r2_access_key_id", "r2_secret_access_key"]:
        val = data.get(key)
        if val is not None and val != "****":
            existing = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
            if existing:
                existing.value = val
            else:
                db.add(Setting(key=key, value=val))
    await db.commit()
    return {"status": "ok"}
