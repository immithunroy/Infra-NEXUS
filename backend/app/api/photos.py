"""Field photo upload, retrieval, replacement, and deletion for TJ boxes and subscribers."""

import mimetypes
import os
import uuid
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
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
TARGET_SIZE = 1440  # ~2 MP square (1440x1440)

PHOTO_TYPES_TJ = {"overall", "internal", "identification"}
PHOTO_TYPES_SUBSCRIBER = {"overall", "equipment", "identification"}
ENTITY_PHOTO_TYPES = {
    "tj": PHOTO_TYPES_TJ,
    "subscriber": PHOTO_TYPES_SUBSCRIBER,
}


def _storage_subdir(entity_type: str, entity_id: str) -> Path:
    return UPLOAD_DIR / entity_type / entity_id


def _save_processed_image(
    img_bytes: bytes,
    storage_key: Path,
    entity_type: str,
    entity_id: str,
    photo_type: str,
    latitude: float | None,
    longitude: float | None,
    original_filename: str,
    user: User,
) -> dict:
    """Process image: crop to 1:1 square, resize to ~2MP, add watermark, save as JPEG."""
    from PIL import Image, ImageDraw, ImageFont

    import io

    img = Image.open(io.BytesIO(img_bytes))

    # Convert to RGB if necessary (handles RGBA, palette, etc.)
    if img.mode not in ("RGB",):
        img = img.convert("RGB")

    # 1:1 square crop from center
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))

    # Resize to target (~2MP square)
    if img.size[0] != TARGET_SIZE:
        img = img.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)

    # Draw watermark
    draw = ImageDraw.Draw(img)
    font_size = 12
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
        font_bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except (OSError, IOError):
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", font_size)
            font_bold = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()
            font_bold = font

    # Build watermark lines
    if entity_type == "tj":
        label_id = "TJ ID:"
        value_id = entity_id
    else:
        label_id = "SUBSCRIBER ID:"
        value_id = entity_id

    lat_str = f"{latitude:.6f}" if latitude is not None else "N/A"
    lng_str = f"{longitude:.6f}" if longitude is not None else "N/A"
    gps_text = f"{lat_str}, {lng_str}"

    line1 = f"{label_id} {value_id}"
    line2 = f"GPS: {gps_text}"

    # Calculate text position (bottom-left with padding)
    padding = 10
    bbox1 = draw.textbbox((0, 0), line1, font=font_bold)
    bbox2 = draw.textbbox((0, 0), line2, font=font)
    line_h = bbox1[3] - bbox1[1] + 4
    total_h = (bbox1[3] - bbox1[1]) + (bbox2[3] - bbox2[1]) + 8
    y_start = TARGET_SIZE - total_h - padding

    # Draw semi-transparent background for readability
    max_w = max(bbox1[2] - bbox1[0], bbox2[2] - bbox2[0])
    bg_rect = [padding - 4, y_start - 4, padding + max_w + 8, y_start + total_h + 8]
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rounded_rectangle(bg_rect, radius=4, fill=(0, 0, 0, 140))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    # Draw text
    draw.text((padding, y_start), line1, fill="white", font=font_bold)
    draw.text((padding, y_start + line_h), line2, fill="white", font=font)

    # Save as JPEG
    storage_key.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(storage_key), "JPEG", quality=85)

    return {
        "width": img.size[0],
        "height": img.size[1],
        "file_size": storage_key.stat().st_size,
    }


@router.post("/{entity_type}/{entity_id}")
async def upload_photo(
    entity_type: str,
    entity_id: str,
    photo_type: str = "",
    latitude: float | None = None,
    longitude: float | None = None,
    captured_at: str = "",
    file: UploadFile = File(...),
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Upload a field photo for a TJ or subscriber entity."""

    # Validate entity type
    if entity_type not in ENTITY_PHOTO_TYPES:
        raise HTTPException(400, f"Invalid entity type: {entity_type}. Must be 'tj' or 'subscriber'.")

    # Validate photo type
    valid_types = ENTITY_PHOTO_TYPES[entity_type]
    if photo_type not in valid_types:
        raise HTTPException(400, f"Invalid photo type: {photo_type}. Must be one of: {', '.join(sorted(valid_types))}")

    # Validate file
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image.")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File extension must be one of: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    # Read file bytes
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)} MB.")

    # Build storage key
    filename = f"{photo_type}.jpg"
    storage_key = _storage_subdir(entity_type, entity_id) / filename
    rel_key = f"{entity_type}/{entity_id}/{filename}"

    # Process and save image
    try:
        result = _save_processed_image(
            img_bytes=content,
            storage_key=storage_key,
            entity_type=entity_type,
            entity_id=entity_id,
            photo_type=photo_type,
            latitude=latitude,
            longitude=longitude,
            original_filename=file.filename or "",
            user=user,
        )
    except Exception as e:
        raise HTTPException(400, f"Failed to process image: {str(e)}")

    # Parse captured_at
    from datetime import datetime, timezone
    captured_dt = None
    if captured_at:
        try:
            captured_dt = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass

    # Upsert photo record
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
        existing.file_size = result["file_size"]
        existing.width = result["width"]
        existing.height = result["height"]
        existing.latitude = latitude
        existing.longitude = longitude
        existing.captured_at = captured_dt
        existing.captured_by = user.username
        existing.uploaded_by = user.id
        photo = existing
    else:
        photo = FieldPhoto(
            entity_type=entity_type,
            entity_id=entity_id,
            photo_type=photo_type,
            storage_key=rel_key,
            original_filename=file.filename or "",
            mime_type="image/jpeg",
            file_size=result["file_size"],
            width=result["width"],
            height=result["height"],
            latitude=latitude,
            longitude=longitude,
            captured_at=captured_dt,
            captured_by=user.username,
            uploaded_by=user.id,
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

    PHOTO_UPLOAD_DIR = Path(os.environ.get("PHOTO_UPLOAD_DIR", "/app/uploads/field-photos"))

    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "total_required": len(valid_types),
        "totalUploaded": len([p for p in photos if (PHOTO_UPLOAD_DIR / p.storage_key).exists()]),
        "photos": [
            {
                "photo_type": pt,
                "uploaded": pt in photo_map and (PHOTO_UPLOAD_DIR / photo_map[pt].storage_key).exists(),
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
                        "created_at": photo_map[pt].created_at.isoformat() if photo_map[pt].created_at else None,
                    }
                    if pt in photo_map and (PHOTO_UPLOAD_DIR / photo_map[pt].storage_key).exists()
                    else {}
                ),
            }
            for pt in sorted(valid_types)
        ],
    }


@file_router.get("/{path:path}")
async def serve_photo(
    path: str,
):
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
