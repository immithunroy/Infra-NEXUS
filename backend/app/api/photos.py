"""Field photo upload, retrieval, replacement, and deletion for TJ boxes and subscribers.

Supports both web frontend (TJ/subscriber documentation) and Android app (field captures).
All photos are server-side processed: EXIF-corrected, center-cropped, resized to 1440×1440,
stamped with metadata, and compressed to JPEG < 1 MB.
"""

import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_db
from ..models import FieldPhoto, User
from ..security import get_current_user, require_write

router = APIRouter(prefix="/api/photos", dependencies=[Depends(get_current_user)])
file_router = APIRouter(prefix="/api/photos/file")

settings = get_settings()
UPLOAD_DIR = Path(os.environ.get("PHOTO_UPLOAD_DIR", "/app/uploads/field-photos"))

ALLOWED_MIME_PREFIXES = ("image/",)
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB upload limit

PHOTO_TYPES_TJ = {"overall", "internal", "identification"}
PHOTO_TYPES_SUBSCRIBER = {"overall", "equipment", "identification"}
ENTITY_PHOTO_TYPES = {
    "tj": PHOTO_TYPES_TJ,
    "subscriber": PHOTO_TYPES_SUBSCRIBER,
}


def _validate_gps(lat: float | None, lng: float | None) -> None:
    """Validate GPS coordinates are within legal ranges."""
    if lat is not None and not (-90 <= lat <= 90):
        raise HTTPException(400, f"Latitude must be between -90 and 90, got {lat}")
    if lng is not None and not (-180 <= lng <= 180):
        raise HTTPException(400, f"Longitude must be between -180 and 180, got {lng}")


def _parse_captured_at(raw: str) -> datetime | None:
    """Parse ISO 8601 capture timestamp."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _storage_subdir(entity_type: str, entity_id: str) -> Path:
    return UPLOAD_DIR / entity_type / entity_id


@router.post("/{entity_type}/{entity_id}")
async def upload_photo(
    entity_type: str,
    entity_id: str,
    photo_type: str = "",
    pppoe_username: str = "",
    latitude: float | None = None,
    longitude: float | None = None,
    gps_accuracy: float | None = None,
    captured_at: str = "",
    file: UploadFile = File(...),
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Upload a field photo for a TJ or subscriber entity.

    Accepts metadata from Android app or web frontend.
    Photo is processed server-side: EXIF correction → crop → resize → stamp → compress.
    """
    import logging
    _log = logging.getLogger("olt_commander.photos")
    _log.info(
        "PHOTO-UPLOAD RECEIVED: entity_type=%s entity_id=%s photo_type=%s "
        "pppoe_username=%s latitude=%s longitude=%s gps_accuracy=%s captured_at=%s file=%s",
        entity_type, entity_id, photo_type,
        pppoe_username, latitude, longitude, gps_accuracy, captured_at,
        f"{file.filename}({file.size})" if file else "None",
    )

    # --- Validate entity type ---
    if entity_type not in ENTITY_PHOTO_TYPES:
        raise HTTPException(400, f"Invalid entity type: {entity_type}. Must be 'tj' or 'subscriber'.")

    # --- Validate photo type ---
    valid_types = ENTITY_PHOTO_TYPES[entity_type]
    if photo_type not in valid_types:
        raise HTTPException(400, f"Invalid photo type: {photo_type}. Must be one of: {', '.join(sorted(valid_types))}")

    # --- Validate file ---
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image.")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File extension must be one of: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    # --- Read file bytes ---
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)} MB.")

    # --- Validate GPS ---
    _validate_gps(latitude, longitude)
    if gps_accuracy is not None and gps_accuracy < 0:
        raise HTTPException(400, f"GPS accuracy must be >= 0, got {gps_accuracy}")

    # --- Parse capture timestamp ---
    captured_dt = _parse_captured_at(captured_at)

    # --- Determine stamp entity type and ID ---
    stamp_entity_type = "tj" if entity_type == "tj" else "user"
    stamp_entity_id = entity_id
    if entity_type == "subscriber" and pppoe_username:
        stamp_entity_id = pppoe_username

    # Look up entity name for stamp
    stamp_entity_name = ""
    if stamp_entity_id:
        try:
            from sqlalchemy import select as sa_select
            if stamp_entity_type == "tj":
                from ..models import TjBox
                res = await db.execute(sa_select(TjBox.name).where(TjBox.unique_id == stamp_entity_id))
                stamp_entity_name = res.scalar_one_or_none() or ""
            else:
                from ..models import Onu as OnuPhoto
                res = await db.execute(sa_select(OnuPhoto.name).where(OnuPhoto.subscriber == stamp_entity_id))
                stamp_entity_name = res.scalar_one_or_none() or ""
        except Exception:
            pass

    # --- Process image via shared pipeline ---
    from ..services.photo_processing import process_photo

    try:
        processed_bytes, width, height = process_photo(
            image_bytes=content,
            entity_type=stamp_entity_type,
            entity_id=stamp_entity_id,
            entity_name=stamp_entity_name,
            latitude=latitude,
            longitude=longitude,
            gps_accuracy=gps_accuracy,
            captured_at=captured_dt,
        )
    except ValueError as e:
        raise HTTPException(400, f"Failed to process image: {e}")
    except Exception as e:
        raise HTTPException(400, f"Failed to process image: {e}")

    # --- Save processed image ---
    filename = f"{photo_type}.jpg"
    storage_key = _storage_subdir(entity_type, entity_id) / filename
    rel_key = f"{entity_type}/{entity_id}/{filename}"

    storage_key.parent.mkdir(parents=True, exist_ok=True)
    with open(storage_key, "wb") as f:
        f.write(processed_bytes)

    file_size = len(processed_bytes)

    # --- Upsert photo record ---
    existing = (
        await db.execute(
            select(FieldPhoto).where(
                FieldPhoto.entity_type == entity_type,
                FieldPhoto.entity_id == entity_id,
                FieldPhoto.photo_type == photo_type,
            )
        )
    ).scalar_one_or_none()

    if existing:
        existing.storage_key = rel_key
        existing.original_filename = file.filename or ""
        existing.mime_type = "image/jpeg"
        existing.file_size = file_size
        existing.width = width
        existing.height = height
        existing.latitude = latitude
        existing.longitude = longitude
        existing.gps_accuracy = gps_accuracy
        existing.captured_at = captured_dt
        existing.captured_by = user.username
        existing.uploaded_by = user.id
        existing.pppoe_username = pppoe_username if entity_type == "subscriber" else ""
        photo = existing
    else:
        photo = FieldPhoto(
            entity_type=entity_type,
            entity_id=entity_id,
            photo_type=photo_type,
            storage_key=rel_key,
            original_filename=file.filename or "",
            mime_type="image/jpeg",
            file_size=file_size,
            width=width,
            height=height,
            latitude=latitude,
            longitude=longitude,
            gps_accuracy=gps_accuracy,
            captured_at=captured_dt,
            captured_by=user.username,
            uploaded_by=user.id,
            pppoe_username=pppoe_username if entity_type == "subscriber" else "",
        )
        db.add(photo)

    await db.commit()
    await db.refresh(photo)

    return {
        "id": photo.id,
        "photo_type": photo.photo_type,
        "storage_key": photo.storage_key,
        "file_size": photo.file_size,
        "width": photo.width,
        "height": photo.height,
        "url": f"/api/photos/file/{rel_key}",
    }


@router.get("/{entity_type}/{entity_id}")
async def list_photos(
    entity_type: str,
    entity_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all photos for an entity."""
    if entity_type not in ENTITY_PHOTO_TYPES:
        raise HTTPException(400, f"Invalid entity type: {entity_type}")

    result = await db.execute(
        select(FieldPhoto).where(
            FieldPhoto.entity_type == entity_type,
            FieldPhoto.entity_id == entity_id,
        )
    )
    photos = result.scalars().all()

    valid_types = ENTITY_PHOTO_TYPES[entity_type]
    photo_map = {p.photo_type: p for p in photos}

    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "total_required": len(valid_types),
        "totalUploaded": len(photos),
        "photos": [
            {
                "photo_type": pt,
                "uploaded": pt in photo_map,
                **(
                    {
                        "id": photo_map[pt].id,
                        "url": f"/api/photos/file/{photo_map[pt].storage_key}",
                        "file_size": photo_map[pt].file_size,
                        "width": photo_map[pt].width,
                        "height": photo_map[pt].height,
                        "latitude": photo_map[pt].latitude,
                        "longitude": photo_map[pt].longitude,
                        "captured_at": photo_map[pt].captured_at.isoformat() if photo_map[pt].captured_at else None,
                        "captured_by": photo_map[pt].captured_by,
                        "pppoe_username": photo_map[pt].pppoe_username or "",
                        "created_at": photo_map[pt].created_at.isoformat() if photo_map[pt].created_at else None,
                    }
                    if pt in photo_map
                    else {}
                ),
            }
            for pt in sorted(valid_types)
        ],
    }


@file_router.get("/{path:path}")
async def serve_photo(path: str):
    """Serve a photo file from disk (no auth — images loaded via <img> tags)."""
    file_path = UPLOAD_DIR / path
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(404, "Photo not found.")

    # Prevent path traversal
    try:
        file_path.resolve().relative_to(UPLOAD_DIR.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied.")

    media_type = mimetypes.guess_type(str(file_path))[0] or "image/jpeg"
    return FileResponse(str(file_path), media_type=media_type)


@router.delete("/{entity_type}/{entity_id}/{photo_type}")
async def delete_photo(
    entity_type: str,
    entity_id: str,
    photo_type: str,
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Delete a specific photo."""
    if entity_type not in ENTITY_PHOTO_TYPES:
        raise HTTPException(400, f"Invalid entity type: {entity_type}")

    result = await db.execute(
        select(FieldPhoto).where(
            FieldPhoto.entity_type == entity_type,
            FieldPhoto.entity_id == entity_id,
            FieldPhoto.photo_type == photo_type,
        )
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(404, "Photo not found.")

    # Remove file from disk
    file_path = UPLOAD_DIR / photo.storage_key
    if file_path.exists():
        file_path.unlink()

    await db.delete(photo)
    await db.commit()

    return {"ok": True, "deleted": photo_type}
