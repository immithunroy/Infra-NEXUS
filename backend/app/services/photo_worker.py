"""Background photo processing worker.

Uses APScheduler to process photos asynchronously after upload.
"""

import logging
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from ..database import SessionLocal
from ..models import FiberApprovalRequest
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.photo_worker")

# Storage directories
UPLOAD_DIR = Path("/app/uploads/approval-photos")
PROCESSED_DIR = Path("/app/uploads/processed-photos")


async def queue_photo_processing(
    db,
    filename: str,
    filepath: str,
    entity_type: str,
    entity_id: str,
    latitude: float | None,
    longitude: float | None,
    captured_at: datetime | None,
    category: str,
    approval_id: int | None = None,
):
    """Queue a photo for background processing.
    
    This function is called from the upload endpoint to start background processing.
    """
    # Import here to avoid circular imports
    from .scheduler import _scheduler
    
    if _scheduler is None:
        logger.warning("Scheduler not available, processing photo synchronously")
        await _process_photo_job(
            filename=filename,
            filepath=filepath,
            entity_type=entity_type,
            entity_id=entity_id,
            latitude=latitude,
            longitude=longitude,
            captured_at=captured_at,
            category=category,
            approval_id=approval_id,
        )
        return
    
    # Add job to scheduler
    _scheduler.add_job(
        _process_photo_job,
        "date",
        run_date=None,  # Run immediately
        kwargs={
            "filename": filename,
            "filepath": filepath,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "latitude": latitude,
            "longitude": longitude,
            "captured_at": captured_at,
            "category": category,
            "approval_id": approval_id,
        },
        id=f"photo_process_{filename}",
        replace_existing=True,
        misfire_grace_time=60,
    )
    logger.info("Queued photo processing job for %s", filename)


async def _process_photo_job(
    filename: str,
    filepath: str,
    entity_type: str,
    entity_id: str,
    latitude: float | None,
    longitude: float | None,
    captured_at: datetime | None,
    category: str,
    approval_id: int | None = None,
):
    """Process a photo in the background.
    
    This runs as an APScheduler job.
    """
    logger.info("Starting photo processing for %s", filename)
    
    try:
        # Import processing function
        from .photo_processing import process_photo
        
        # Read original image
        with open(filepath, "rb") as f:
            image_bytes = f.read()
        
        # Process image
        processed_bytes, width, height = process_photo(
            image_bytes=image_bytes,
            entity_type=entity_type,
            entity_id=entity_id,
            latitude=latitude,
            longitude=longitude,
            captured_at=captured_at,
        )
        
        # Save processed image
        PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
        processed_path = PROCESSED_DIR / f"processed_{filename}"
        
        with open(processed_path, "wb") as f:
            f.write(processed_bytes)
        
        logger.info(
            "Photo processed successfully: %s -> %s (%dx%d, %d bytes)",
            filename, processed_path, width, height, len(processed_bytes)
        )
        
        # Update approval request status if approval_id provided
        if approval_id:
            async with SessionLocal() as db:
                result = await db.execute(
                    select(FiberApprovalRequest).where(FiberApprovalRequest.id == approval_id)
                )
                req = result.scalar_one_or_none()
                if req:
                    req.photo_processing_status = "COMPLETED"
                    req.photo_processing_error = ""
                    await db.commit()
                    logger.info("Updated approval #%d photo status to COMPLETED", approval_id)
        
    except Exception as e:
        logger.error("Photo processing failed for %s: %s", filename, e, exc_info=True)
        
        # Update approval request status on failure
        if approval_id:
            try:
                async with SessionLocal() as db:
                    result = await db.execute(
                        select(FiberApprovalRequest).where(FiberApprovalRequest.id == approval_id)
                    )
                    req = result.scalar_one_or_none()
                    if req:
                        req.photo_processing_status = "FAILED"
                        req.photo_processing_error = str(e)[:500]
                        await db.commit()
                        logger.info("Updated approval #%d photo status to FAILED", approval_id)
            except Exception as db_err:
                logger.error("Failed to update approval status: %s", db_err)


def get_processed_photo_path(filename: str) -> str | None:
    """Get the path to the processed photo if it exists."""
    processed_path = PROCESSED_DIR / f"processed_{filename}"
    if processed_path.exists():
        return str(processed_path)
    return None


def serve_processed_photo(filename: str):
    """Serve a processed photo if available, otherwise return None."""
    processed_path = PROCESSED_DIR / f"processed_{filename}"
    if processed_path.exists():
        return processed_path
    return None
