"""Centralized NOC approval queue for all Android / field_team submissions.

Every submission that requires NOC verification enters this queue before
becoming active/approved. Supports: TJ, TJ+Splitter, Cable, User,
User Location, Splitter, Splice Box, Infrastructure, and other types.
"""
import json
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    Cable, CableSegment, FieldPhoto, FiberApprovalRequest, FiberLoop, Splice, Splitter, TjBox,
    ApprovalStatus, ApprovalPriority, CableCut, User, Onu,
)
from ..schemas import (
    ApprovalSubmitRequest, ApprovalReviewRequest, ApprovalReturnRequest,
    ApprovalResubmitRequest, ApprovalOut, ApprovalListOut, PendingCountOut,
    CableCreate, TjBoxCreate, SplitterCreate, SpliceCreate,
)
from ..security import get_current_user, require_noc_approval, require_approval_submit, user_role
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.approvals")

router = APIRouter(prefix="/api/approvals", tags=["approvals"])

# Photo storage directory (relative to app root, mounted as Docker volume)
UPLOAD_DIR = Path("/app/uploads/approval-photos")

VALID_ENTITY_TYPES = {
    "tj", "tj_box", "tj_splitter", "cable", "user", "user_location",
    "splitter", "splice_box", "infrastructure", "loop", "cable_cut", "other",
}
VALID_ACTIONS = {"create", "update", "delete"}
VALID_STATUSES = {"pending", "approved", "rejected", "returned_for_correction", "resubmitted"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PendingCountByType(BaseModel):
    tj: int = 0
    tj_splitter: int = 0
    cable: int = 0
    user: int = 0
    user_location: int = 0
    splitter: int = 0
    splice_box: int = 0
    infrastructure: int = 0
    loop: int = 0
    cable_cut: int = 0
    other: int = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _entity_label(entity_type: str, payload: dict) -> str:
    """Extract a human-readable label from the payload based on entity type."""
    if entity_type == "tj":
        return payload.get("name", payload.get("unique_id", ""))
    if entity_type == "tj_splitter":
        tj_name = payload.get("tj", {}).get("name", "")
        sp_ratio = payload.get("splitter", {}).get("split_ratio", "")
        return f"{tj_name} + 1:{sp_ratio}" if sp_ratio else tj_name
    if entity_type == "cable":
        return payload.get("link_name", payload.get("code", ""))
    if entity_type == "user":
        return payload.get("name", payload.get("username", ""))
    if entity_type == "user_location":
        return payload.get("username", payload.get("onu_id", ""))
    if entity_type == "splitter":
        ratio = payload.get("split_ratio", "")
        name = payload.get("name", "")
        return f"{name} (1:{ratio})" if ratio else name
    if entity_type in ("splice_box", "infrastructure"):
        return payload.get("name", "")
    if entity_type == "loop":
        return f"Cable #{payload.get('cable_id', '?')} loop"
    if entity_type == "cable_cut":
        return f"Cable #{payload.get('cable_id', '?')} cut"
    return payload.get("name", payload.get("id", ""))


async def _snapshot_existing(entity_type: str, entity_id: int, db: AsyncSession) -> dict:
    """Fetch existing entity data for comparison (updates only)."""
    if not entity_id:
        return {}
    try:
        if entity_type == "tj":
            result = await db.execute(select(TjBox).where(TjBox.id == entity_id))
            obj = result.scalar_one_or_none()
            if obj:
                return {"name": obj.name, "box_type": obj.box_type, "tj_port": obj.tj_port,
                        "capacity": obj.capacity, "tray_count": obj.tray_count,
                        "lat": obj.lat, "lng": obj.lng, "address": obj.address}
        elif entity_type == "cable":
            result = await db.execute(select(Cable).where(Cable.id == entity_id))
            obj = result.scalar_one_or_none()
            if obj:
                return {"link_name": obj.link_name, "code": obj.code, "core_count": obj.core_count,
                        "manufacturer": obj.manufacturer, "cable_type": obj.cable_type,
                        "src_tj_id": obj.src_tj_id, "dst_tj_id": obj.dst_tj_id}
        elif entity_type == "splitter":
            result = await db.execute(select(Splitter).where(Splitter.id == entity_id))
            obj = result.scalar_one_or_none()
            if obj:
                return {"name": obj.name, "split_ratio": obj.split_ratio, "tj_box_id": obj.tj_box_id,
                        "input_core": obj.input_core, "output_cores": obj.output_cores,
                        "lat": obj.lat, "lng": obj.lng}
        elif entity_type == "user_location":
            result = await db.execute(select(Onu).where(Onu.id == entity_id))
            obj = result.scalar_one_or_none()
            if obj:
                return {"gps_lat": obj.gps_lat, "gps_lng": obj.gps_lng,
                        "address": obj.address, "name": obj.name}
    except Exception as e:
        logger.warning("Failed to snapshot existing entity: %s", e)
    return {}


def _parse_out(req: FiberApprovalRequest) -> ApprovalOut:
    """Convert a DB row to the ApprovalOut response schema."""
    return ApprovalOut(
        id=req.id,
        requested_by=req.requested_by,
        submitted_by_name=req.submitted_by_name,
        action=req.action,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        payload=json.loads(req.payload_json) if req.payload_json else {},
        previous_data=json.loads(req.previous_data_json) if req.previous_data_json else None,
        status=req.status,
        priority=req.priority,
        reviewed_by=req.reviewed_by,
        review_note=req.review_note,
        correction_note=req.correction_note,
        photos=json.loads(req.photos_json) if req.photos_json else [],
        photo_processing_status=req.photo_processing_status or "",
        photo_processing_error=req.photo_processing_error or "",
        location=json.loads(req.location_json) if req.location_json else None,
        created_at=req.created_at,
        reviewed_at=req.reviewed_at,
        resubmitted_at=req.resubmitted_at,
    )


def _parse_list_out(req: FiberApprovalRequest) -> ApprovalListOut:
    """Convert a DB row to the compact ApprovalListOut schema."""
    payload = json.loads(req.payload_json) if req.payload_json else {}
    return ApprovalListOut(
        id=req.id,
        requested_by=req.requested_by,
        submitted_by_name=req.submitted_by_name,
        action=req.action,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        entity_label=_entity_label(req.entity_type, payload),
        status=req.status,
        priority=req.priority,
        created_at=req.created_at,
        reviewed_at=req.reviewed_at,
    )


# ---------------------------------------------------------------------------
# Submit approval request (Android / field_team)
# ---------------------------------------------------------------------------

@router.post("/submit", response_model=ApprovalOut, status_code=201)
async def submit_approval(
    body: ApprovalSubmitRequest,
    user=Depends(require_approval_submit),
    db: AsyncSession = Depends(get_db),
):
    """Android app submits any record for NOC approval."""
    if body.entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(400, f"Invalid entity_type: {body.entity_type}. Must be one of {VALID_ENTITY_TYPES}")
    if body.action not in VALID_ACTIONS:
        raise HTTPException(400, f"Invalid action: {body.action}. Must be one of {VALID_ACTIONS}")
    if body.priority not in {p.value for p in ApprovalPriority}:
        raise HTTPException(400, f"Invalid priority: {body.priority}")

    previous_data = None
    if body.action == "update" and body.entity_id:
        previous_data = await _snapshot_existing(body.entity_type, body.entity_id, db)

    req = FiberApprovalRequest(
        requested_by=user.id,
        submitted_by_name=user.username,
        action=body.action,
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        payload_json=json.dumps(body.payload),
        previous_data_json=json.dumps(previous_data) if previous_data else "",
        status=ApprovalStatus.pending.value,
        priority=body.priority,
        photos_json=json.dumps(body.photos),
        location_json=json.dumps(body.location) if body.location else "",
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    logger.info("Approval request #%d submitted: %s %s by %s", req.id, req.action, req.entity_type, user.username)
    return _parse_out(req)


# ---------------------------------------------------------------------------
# List approval requests
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ApprovalListOut])
async def list_approvals(
    status: str | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List approval requests. field_team sees only their own; NOC/admin sees all."""
    q = select(FiberApprovalRequest)

    role = user_role(user)
    if role == "field_team":
        q = q.where(FiberApprovalRequest.requested_by == user.id)

    if status:
        q = q.where(FiberApprovalRequest.status == status)
    if entity_type:
        q = q.where(FiberApprovalRequest.entity_type == entity_type)
    if action:
        q = q.where(FiberApprovalRequest.action == action)

    q = q.order_by(FiberApprovalRequest.created_at.desc())
    result = await db.execute(q)
    rows = result.scalars().all()

    return [_parse_list_out(r) for r in rows]


# ---------------------------------------------------------------------------
# Pending count (dashboard badge)
# ---------------------------------------------------------------------------

@router.get("/pending-count", response_model=PendingCountOut)
async def pending_count(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Count pending approval requests, broken down by entity type."""
    q = select(
        FiberApprovalRequest.entity_type,
        func.count(FiberApprovalRequest.id),
    ).where(FiberApprovalRequest.status == ApprovalStatus.pending.value)

    role = user_role(user)
    if role == "field_team":
        q = q.where(FiberApprovalRequest.requested_by == user.id)

    q = q.group_by(FiberApprovalRequest.entity_type)
    result = await db.execute(q)
    rows = result.all()

    by_type = {}
    total = 0
    for entity_type, count in rows:
        by_type[entity_type] = count
        total += count

    return PendingCountOut(total=total, by_type=by_type)


# ---------------------------------------------------------------------------
# Get single approval detail
# ---------------------------------------------------------------------------

@router.get("/{request_id}", response_model=ApprovalOut)
async def get_approval(
    request_id: int,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Approval request not found")

    role = user_role(user)
    if role == "field_team" and req.requested_by != user.id:
        raise HTTPException(403, "You can only view your own approval requests")

    return _parse_out(req)


# ---------------------------------------------------------------------------
# Approve
# ---------------------------------------------------------------------------

@router.put("/{request_id}/approve", response_model=ApprovalOut)
async def approve_request(
    request_id: int,
    body: ApprovalReviewRequest = ApprovalReviewRequest(),
    user=Depends(require_noc_approval),
    db: AsyncSession = Depends(get_db),
):
    """NOC/admin approves a pending request and executes the change."""
    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Approval request not found")
    if req.status not in (ApprovalStatus.pending.value, ApprovalStatus.resubmitted.value):
        raise HTTPException(400, f"Request is {req.status}, cannot approve")

    payload = json.loads(req.payload_json)

    # Execute the change against the actual DB
    try:
        await _execute_action(req.action, req.entity_type, req.entity_id, payload, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to execute approved request #%d: %s", req.id, e)
        raise HTTPException(500, f"Failed to execute: {str(e)}")

    req.status = ApprovalStatus.approved.value
    req.reviewed_by = user.id
    req.review_note = body.review_note
    req.reviewed_at = utcnow()
    await db.commit()
    await db.refresh(req)

    logger.info("Approval request #%d approved by %s", req.id, user.username)
    return _parse_out(req)


# ---------------------------------------------------------------------------
# Reject
# ---------------------------------------------------------------------------

@router.put("/{request_id}/reject", response_model=ApprovalOut)
async def reject_request(
    request_id: int,
    body: ApprovalReviewRequest = ApprovalReviewRequest(),
    user=Depends(require_noc_approval),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Approval request not found")
    if req.status not in (ApprovalStatus.pending.value, ApprovalStatus.resubmitted.value):
        raise HTTPException(400, f"Request is {req.status}, cannot reject")

    req.status = ApprovalStatus.rejected.value
    req.reviewed_by = user.id
    req.review_note = body.review_note
    req.reviewed_at = utcnow()
    await db.commit()
    await db.refresh(req)

    logger.info("Approval request #%d rejected by %s", req.id, user.username)
    return _parse_out(req)


# ---------------------------------------------------------------------------
# Return for correction
# ---------------------------------------------------------------------------

@router.put("/{request_id}/return", response_model=ApprovalOut)
async def return_for_correction(
    request_id: int,
    body: ApprovalReturnRequest,
    user=Depends(require_noc_approval),
    db: AsyncSession = Depends(get_db),
):
    """NOC returns a submission to the employee for correction."""
    if not body.correction_note.strip():
        raise HTTPException(400, "correction_note is required when returning for correction")

    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Approval request not found")
    if req.status not in (ApprovalStatus.pending.value, ApprovalStatus.resubmitted.value):
        raise HTTPException(400, f"Request is {req.status}, cannot return for correction")

    req.status = ApprovalStatus.returned_for_correction.value
    req.reviewed_by = user.id
    req.correction_note = body.correction_note
    req.reviewed_at = utcnow()
    await db.commit()
    await db.refresh(req)

    logger.info("Approval request #%d returned for correction by %s", req.id, user.username)
    return _parse_out(req)


# ---------------------------------------------------------------------------
# Delete approval request
# ---------------------------------------------------------------------------

@router.delete("/{request_id}", response_model=ApprovalOut)
async def delete_approval(
    request_id: int,
    user=Depends(require_noc_approval),
    db: AsyncSession = Depends(get_db),
):
    """NOC/admin deletes an approval request.
    
    Only pending, resubmitted, or returned_for_correction requests can be deleted.
    Approved/rejected requests are kept for audit trail.
    """
    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Approval request not found")
    
    # Only allow deleting non-finalized requests
    if req.status not in (
        ApprovalStatus.pending.value,
        ApprovalStatus.resubmitted.value,
        ApprovalStatus.returned_for_correction.value,
    ):
        raise HTTPException(400, f"Cannot delete request with status '{req.status}'")
    
    # Clean up associated photos
    photos = json.loads(req.photos_json) if req.photos_json else []
    for photo_filename in photos:
        try:
            photo_path = UPLOAD_DIR / photo_filename
            if photo_path.exists():
                photo_path.unlink()
                logger.info("Deleted approval photo: %s", photo_path)
        except Exception as e:
            logger.warning("Failed to delete photo %s: %s", photo_filename, e)
    
    # Also clean up pending photos directory if this is a TJ request
    if req.entity_type in ("tj", "tj_box"):
        try:
            import shutil
            pending_dir = _PENDING_PHOTOS_DIR / str(req.id)
            if pending_dir.exists():
                shutil.rmtree(pending_dir, ignore_errors=True)
                logger.info("Deleted pending photos dir: %s", pending_dir)
        except Exception as e:
            logger.warning("Failed to delete pending photos for approval #%d: %s", req.id, e)
    
    # Delete the approval request
    await db.delete(req)
    await db.commit()
    
    logger.info("Approval request #%d deleted by %s (status was %s)", req.id, user.username, req.status)
    return _parse_out(req)


# ---------------------------------------------------------------------------
# Resubmit (employee corrects and resubmits)
# ---------------------------------------------------------------------------

@router.put("/{request_id}/resubmit", response_model=ApprovalOut)
async def resubmit(
    request_id: int,
    body: ApprovalResubmitRequest,
    user=Depends(require_approval_submit),
    db: AsyncSession = Depends(get_db),
):
    """Employee resubmits corrected data after NOC returned for correction."""
    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Approval request not found")
    if req.status != ApprovalStatus.returned_for_correction.value:
        raise HTTPException(400, f"Request is {req.status}, can only resubmit from 'returned_for_correction'")
    if req.requested_by != user.id:
        raise HTTPException(403, "You can only resubmit your own approval requests")

    req.payload_json = json.dumps(body.payload)
    req.photos_json = json.dumps(body.photos) if body.photos else req.photos_json
    req.correction_note = ""  # clear old correction note
    req.status = ApprovalStatus.resubmitted.value
    req.resubmitted_at = utcnow()
    await db.commit()
    await db.refresh(req)

    logger.info("Approval request #%d resubmitted by %s", req.id, user.username)
    return _parse_out(req)


# ---------------------------------------------------------------------------
# Photo upload
# ---------------------------------------------------------------------------

@router.post("/upload-photo")
async def upload_photo(
    file: UploadFile = File(None),
    photo: UploadFile = File(None),
    category: str = Form(""),
    entity_id: str = Form(""),
    pppoe_username: str = Form(""),
    tj_id: str = Form(""),
    latitude: float = Form(None),
    longitude: float = Form(None),
    gps_accuracy: float = Form(None),
    captured_at: str = Form(""),
    user=Depends(require_approval_submit),
    db: AsyncSession = Depends(get_db),
):
    """Upload a photo for an approval submission. Returns the filename.

    Accepts the file as either 'file' or 'photo' form field to support
    both web frontend and Android mobile app.

    Photo is processed synchronously: EXIF correction → crop → resize → stamp → compress.
    Processing happens BEFORE the response is returned — guaranteed.
    """
    upload = file or photo
    logger.info(
        "UPLOAD-PHOTO RECEIVED: category=%s entity_id=%s user=%s "
        "pppoe_username=%s tj_id=%s latitude=%s longitude=%s gps_accuracy=%s captured_at=%s "
        "file=%s photo=%s content_type=%s",
        category, entity_id, user.username,
        pppoe_username, tj_id, latitude, longitude, gps_accuracy, captured_at,
        f"{file.filename}({file.size})" if file else "None",
        f"{photo.filename}({photo.size})" if photo else "None",
        upload.content_type if upload else "None",
    )
    upload = file or photo
    if not upload:
        raise HTTPException(400, "No file uploaded")
    if not upload.content_type or not upload.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ext = upload.filename.split(".")[-1] if upload.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = UPLOAD_DIR / filename

    content = await upload.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(400, "File size must be less than 10MB")

    # Save original (kept as backup / for retry)
    with open(filepath, "wb") as f:
        f.write(content)

    logger.info("UPLOAD-PHOTO saved original: filename=%s size=%d bytes path=%s", filename, len(content), filepath)

    # --- Validate GPS coordinates ---
    if latitude is not None and not (-90 <= latitude <= 90):
        raise HTTPException(400, f"Latitude must be between -90 and 90, got {latitude}")
    if longitude is not None and not (-180 <= longitude <= 180):
        raise HTTPException(400, f"Longitude must be between -180 and 180, got {longitude}")
    if gps_accuracy is not None and gps_accuracy < 0:
        raise HTTPException(400, f"GPS accuracy must be >= 0, got {gps_accuracy}")

    # --- Parse capture timestamp ---
    captured_dt = None
    if captured_at:
        try:
            captured_dt = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass

    # --- Fallback: read metadata from approval payload_json if form fields are missing ---
    # Android app sends GPS/date/accuracy in the approval SUBMIT payload, but may not
    # re-send them as form fields on the upload-photo endpoint.
    if entity_id and entity_id.isdigit() and (not latitude or not captured_at or not pppoe_username):
        try:
            from sqlalchemy import select as sa_select
            fallback_result = await db.execute(
                sa_select(FiberApprovalRequest).where(FiberApprovalRequest.id == int(entity_id))
            )
            fallback_req = fallback_result.scalar_one_or_none()
            if fallback_req and fallback_req.payload_json:
                fp = json.loads(fallback_req.payload_json)
                if not latitude and fp.get("latitude"):
                    latitude = float(fp["latitude"])
                if not longitude and fp.get("longitude"):
                    longitude = float(fp["longitude"])
                if not gps_accuracy and fp.get("gps_accuracy") is not None:
                    gps_accuracy = float(fp["gps_accuracy"])
                if not captured_at and fp.get("captured_at"):
                    captured_at = fp["captured_at"]
                    try:
                        captured_dt = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
                    except (ValueError, TypeError):
                        pass
                if not pppoe_username and fp.get("pppoe_username"):
                    pppoe_username = fp["pppoe_username"]
                if not tj_id and fp.get("tj_id"):
                    tj_id = fp["tj_id"]
                logger.info("UPLOAD-PHOTO fallback from payload_json: lat=%s lng=%s accuracy=%s captured_at=%s pppoe=%s tj_id=%s",
                            latitude, longitude, gps_accuracy, captured_at, pppoe_username, tj_id)
        except Exception as e:
            logger.warning("UPLOAD-PHOTO: Failed to read payload_json fallback: %s", e)

    # --- Process photo SYNCHRONOUSLY ---
    stamp_entity_type = "user" if category == "user" else "tj"
    stamp_entity_id = pppoe_username or tj_id or entity_id

    processed_url = None
    processed_filename = None

    if stamp_entity_id:
        try:
            from ..services.photo_processing import process_photo

            processed_bytes, width, height = process_photo(
                image_bytes=content,
                entity_type=stamp_entity_type,
                entity_id=stamp_entity_id,
                latitude=latitude,
                longitude=longitude,
                gps_accuracy=gps_accuracy,
                captured_at=captured_dt,
            )

            # Save processed version as the primary file (overwrite original)
            PROCESSED_DIR = UPLOAD_DIR  # Save processed in same directory
            processed_path = PROCESSED_DIR / f"processed_{filename}"
            with open(processed_path, "wb") as f:
                f.write(processed_bytes)

            processed_filename = f"processed_{filename}"
            processed_url = f"/api/approvals/photos/{processed_filename}"

            logger.info(
                "UPLOAD-PHOTO processed synchronously: %s -> processed_%s (%dx%d, %d bytes) "
                "stamp_entity_type=%s stamp_entity_id=%s latitude=%s longitude=%s gps_accuracy=%s captured_at=%s",
                filename, filename, width, height, len(processed_bytes),
                stamp_entity_type, stamp_entity_id, latitude, longitude, gps_accuracy, captured_dt,
            )

            # Update approval status if approval_id provided
            if entity_id and entity_id.isdigit():
                try:
                    from sqlalchemy import update
                    await db.execute(
                        update(FiberApprovalRequest)
                        .where(FiberApprovalRequest.id == int(entity_id))
                        .values(
                            photo_processing_status="COMPLETED",
                            photo_processing_error="",
                        )
                    )
                except Exception as e:
                    logger.warning("Failed to update approval status: %s", e)

        except Exception as e:
            logger.error("UPLOAD-PHOTO processing FAILED for %s: %s", filename, e, exc_info=True)
            # Still save original — don't lose the photo
            processed_url = f"/api/approvals/photos/{filename}"

            if entity_id and entity_id.isdigit():
                try:
                    from sqlalchemy import update
                    await db.execute(
                        update(FiberApprovalRequest)
                        .where(FiberApprovalRequest.id == int(entity_id))
                        .values(
                            photo_processing_status="FAILED",
                            photo_processing_error=str(e)[:500],
                        )
                    )
                except Exception as db_err:
                    logger.warning("Failed to update approval status: %s", db_err)
    else:
        processed_url = f"/api/approvals/photos/{filename}"

    # --- Also write to field-photos system for subscriber/TJ photos ---
    if category in ("user", "tj_box") and entity_id:
        try:
            # Use processed bytes if available, otherwise original
            await _migrate_photo_to_field(content, ext, category, int(entity_id), user, db,
                                          pppoe_username=pppoe_username,
                                          latitude=latitude, longitude=longitude,
                                          gps_accuracy=gps_accuracy,
                                          captured_at=captured_dt)
            await db.commit()
            logger.info("UPLOAD-PHOTO: Migration completed for approval #%s category=%s", entity_id, category)
        except Exception as e:
            logger.warning("UPLOAD-PHOTO: Failed to migrate field photo for approval #%s: %s", entity_id, e, exc_info=True)
    elif category in ("user", "tj_box") and not entity_id:
        logger.warning("UPLOAD-PHOTO: category=%s but no entity_id — photo saved to approval-photos only, will NOT appear in field photos", category)

    return {"filename": processed_filename or filename, "url": processed_url}


@router.get("/photos/{filename}")
async def serve_photo(
    filename: str,
    user=Depends(get_current_user),
):
    """Serve an uploaded approval photo.

    Serves the processed (stamped) photo if available, otherwise the original.
    """
    import mimetypes
    from fastapi.responses import FileResponse

    # Try processed_ prefix first (synchronous processing saves here)
    processed_path = UPLOAD_DIR / f"processed_{filename}"
    if processed_path.exists():
        media_type = mimetypes.guess_type(str(processed_path))[0] or "image/jpeg"
        return FileResponse(processed_path, media_type=media_type)

    # Try background worker processed path
    from ..services.photo_worker import serve_processed_photo
    bg_processed = serve_processed_photo(filename)
    if bg_processed:
        media_type = mimetypes.guess_type(str(bg_processed))[0] or "image/jpeg"
        return FileResponse(bg_processed, media_type=media_type)

    # Fall back to original
    filepath = UPLOAD_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "Photo not found")

    media_type = mimetypes.guess_type(str(filepath))[0] or "image/jpeg"
    return FileResponse(filepath, media_type=media_type)


# ---------------------------------------------------------------------------
# Photo migration: approval photos -> field-photos system
# ---------------------------------------------------------------------------

_SUBSCRIBER_PHOTO_TYPES = ["overall", "equipment", "identification"]
_TJ_PHOTO_TYPES = ["overall", "internal", "identification"]

_FIELD_PHOTOS_DIR = Path(os.environ.get("PHOTO_UPLOAD_DIR", "/app/uploads/field-photos"))
_PENDING_PHOTOS_DIR = Path(os.environ.get("PENDING_PHOTO_DIR", "/app/uploads/pending-photos"))


async def _migrate_photo_to_field(
    img_bytes: bytes, ext: str, category: str, approval_id: int,
    uploaded_by_user: User, db: AsyncSession,
    pppoe_username: str = "",
    latitude: float | None = None,
    longitude: float | None = None,
    gps_accuracy: float | None = None,
    captured_at=None,
):
    """Copy an approval-uploaded photo into the field-photos system.

    Processes the image: EXIF → crop → resize → stamp → compress before saving.
    """
    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == approval_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        logger.warning("MIGRATE-PHOTO: Approval request #%d not found — photo saved to approval-photos only", approval_id)
        return

    payload = json.loads(req.payload_json) if req.payload_json else {}

    if category == "user":
        entity_type = "subscriber"
        subscriber_id = payload.get("subscriber_id")
        pppoe_from_payload = payload.get("pppoe_username")

        # Try to resolve PPPoE username from ONU record
        entity_id = None
        if subscriber_id:
            try:
                onu = await db.get(Onu, int(subscriber_id))
                if onu and onu.subscriber:
                    entity_id = onu.subscriber
                else:
                    logger.warning("MIGRATE-PHOTO: ONU #%s not found or has empty PPPoE (approval #%d)", subscriber_id, approval_id)
            except (ValueError, TypeError) as e:
                logger.warning("MIGRATE-PHOTO: Invalid subscriber_id '%s' (approval #%d): %s", subscriber_id, approval_id, e)

        # Fallback: use pppoe_username from payload if ONU lookup failed
        if not entity_id and pppoe_username:
            entity_id = pppoe_username
            logger.info("MIGRATE-PHOTO: Using pppoe_username from payload as fallback: %s (approval #%d)", entity_id, approval_id)

        # Last resort: use subscriber_id as entity_id
        if not entity_id and subscriber_id:
            entity_id = str(subscriber_id)
            logger.warning("MIGRATE-PHOTO: Using subscriber_id '%s' as entity_id fallback (approval #%d)", subscriber_id, approval_id)

        if not entity_id:
            logger.error("MIGRATE-PHOTO: Cannot determine entity_id for user photo — approval #%d", approval_id)
            return

        # Use PPPoE username for stamping
        stamp_entity_id = pppoe_username or pppoe_from_payload or entity_id
        photo_types = _SUBSCRIBER_PHOTO_TYPES
        target_dir = _FIELD_PHOTOS_DIR / entity_type / entity_id
        logger.info("MIGRATE-PHOTO: User category — subscriber_id=%s entity_id=%s target=%s", subscriber_id, entity_id, target_dir)
    elif category == "tj_box":
        entity_type = "tj"
        stamp_entity_id = payload.get("tj_id", "")
        photo_types = _TJ_PHOTO_TYPES
        # TJ unique_id not yet known — store in pending dir until approved
        target_dir = _PENDING_PHOTOS_DIR / str(approval_id)
        logger.info("MIGRATE-PHOTO: TJ category — approval=%d target=%s", approval_id, target_dir)
    else:
        logger.warning("MIGRATE-PHOTO: Unknown category '%s' for approval #%d", category, approval_id)
        return

    # Determine next available photo slot
    if category == "user":
        existing = (
            await db.execute(
                select(FieldPhoto.photo_type).where(
                    and_(
                        FieldPhoto.entity_type == entity_type,
                        FieldPhoto.entity_id == entity_id,
                    )
                )
            )
        ).scalars().all()
        remaining = [t for t in photo_types if t not in existing]
        if not remaining:
            return
        photo_type = remaining[0]
    else:
        # For pending TJs, count files already in the pending dir
        existing_files = [f.name for f in target_dir.glob("*.jpg")] if target_dir.exists() else []
        remaining = [t for t in photo_types if f"{t}.jpg" not in existing_files]
        if not remaining:
            return
        photo_type = remaining[0]

    # --- Process the image before writing ---
    stamp_type = "user" if category == "user" else "tj"
    processed_bytes = img_bytes
    file_size = len(img_bytes)
    width = 0
    height = 0

    if stamp_entity_id:
        try:
            from ..services.photo_processing import process_photo
            processed_bytes, width, height = process_photo(
                image_bytes=img_bytes,
                entity_type=stamp_type,
                entity_id=stamp_entity_id,
                latitude=latitude,
                longitude=longitude,
                gps_accuracy=gps_accuracy,
                captured_at=captured_at,
            )
            file_size = len(processed_bytes)
            logger.info("MIGRATE-PHOTO: Processed image %dx%d %d bytes for %s/%s",
                        width, height, file_size, entity_type, photo_type)
        except Exception as e:
            logger.error("MIGRATE-PHOTO: Processing failed, using original: %s", e)
            # Fall back to original bytes

    filename = f"{photo_type}.jpg"
    storage_key = target_dir / filename
    storage_key.parent.mkdir(parents=True, exist_ok=True)
    storage_key.write_bytes(processed_bytes)

    # For subscribers, create FieldPhoto record immediately
    if category == "user":
        rel_key = f"{entity_type}/{entity_id}/{filename}"
        db.add(FieldPhoto(
            entity_type=entity_type,
            entity_id=entity_id,
            photo_type=photo_type,
            storage_key=rel_key,
            original_filename=f"{photo_type}.jpg",
            mime_type="image/jpeg",
            file_size=file_size,
            width=width,
            height=height,
            latitude=latitude,
            longitude=longitude,
            gps_accuracy=gps_accuracy,
            captured_at=captured_at,
            pppoe_username=pppoe_username,
            uploaded_by=uploaded_by_user.id,
            captured_by=req.submitted_by_name or "",
        ))
        await db.flush()
        logger.info("Migrated approval photo -> field photo: %s (type=%s, %dx%d, %d bytes)", rel_key, photo_type, width, height, file_size)
    else:
        logger.info("Saved pending TJ photo: %s (type=%s, approval=%d)", storage_key, photo_type, approval_id)


async def _finalize_pending_tj_photos(unique_id: str, db: AsyncSession):
    """Move pending TJ photos (stored by approval_id) into field-photos system."""
    if not _PENDING_PHOTOS_DIR.exists():
        return
    for pending_dir in _PENDING_PHOTOS_DIR.iterdir():
        if not pending_dir.is_dir():
            continue
        approval_id = pending_dir.name
        # Check if this pending dir belongs to a TJ approval
        try:
            result = await db.execute(
                select(FiberApprovalRequest).where(
                    FiberApprovalRequest.id == int(approval_id),
                    FiberApprovalRequest.entity_type == "tj",
                )
            )
            req = result.scalar_one_or_none()
            if not req:
                continue
        except (ValueError, Exception):
            continue

        dest_dir = _FIELD_PHOTOS_DIR / "tj" / unique_id
        dest_dir.mkdir(parents=True, exist_ok=True)

        photo_types = _TJ_PHOTO_TYPES
        for photo_type in photo_types:
            src = pending_dir / f"{photo_type}.jpg"
            if not src.exists():
                continue
            dst = dest_dir / f"{photo_type}.jpg"
            dst.write_bytes(src.read_bytes())
            rel_key = f"tj/{unique_id}/{photo_type}.jpg"
            db.add(FieldPhoto(
                entity_type="tj",
                entity_id=unique_id,
                photo_type=photo_type,
                storage_key=rel_key,
                original_filename=f"{photo_type}.jpg",
                mime_type="image/jpeg",
                file_size=src.stat().st_size,
                captured_by=req.submitted_by_name or "",
            ))

        # Clean up pending dir
        import shutil
        shutil.rmtree(pending_dir, ignore_errors=True)
        logger.info("Finalized pending TJ photos: approval #%s -> tj/%s", approval_id, unique_id)
        break  # only one pending dir per TJ approval

    await db.flush()


# ---------------------------------------------------------------------------
# Execute helpers (shared with fiber_approvals.py)
# ---------------------------------------------------------------------------

async def _next_tj_id(db) -> str:
    result = await db.execute(select(TjBox.unique_id).order_by(TjBox.id.desc()).limit(1))
    last = result.scalar_one_or_none()
    if last:
        try:
            num = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            num = 5001
    else:
        num = 5001
    return f"TJ-{num:04d}"


async def _next_sp_id(db) -> str:
    result = await db.execute(select(Splitter.unique_id).order_by(Splitter.id.desc()).limit(1))
    last = result.scalar_one_or_none()
    if last:
        try:
            num = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            num = 1001
    else:
        num = 1001
    return f"SP-{num:04d}"


async def _next_link_id(db) -> str:
    result = await db.execute(select(Cable.link_id).order_by(Cable.id.desc()).limit(1))
    last = result.scalar_one_or_none()
    if last:
        try:
            num = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            num = 1001
    else:
        num = 1001
    return f"LINK-{num:04d}"


async def _execute_action(action: str, entity_type: str, entity_id: int | None, payload: dict, db: AsyncSession):
    """Execute an approved action against the actual database."""
    if entity_type in ("tj", "tj_box"):
        await _execute_tj(action, entity_id, payload, db)
    elif entity_type == "tj_splitter":
        await _execute_tj_splitter(action, entity_id, payload, db)
    elif entity_type == "cable":
        await _execute_cable(action, entity_id, payload, db)
    elif entity_type == "splitter":
        await _execute_splitter(action, entity_id, payload, db)
    elif entity_type == "splice_box":
        await _execute_tj(action, entity_id, payload, db)  # splice box = TJ box
    elif entity_type == "user":
        await _execute_user(action, entity_id, payload, db)
    elif entity_type == "user_location":
        await _execute_user_location(action, entity_id, payload, db)
    elif entity_type == "loop":
        await _execute_loop(action, entity_id, payload, db)
    elif entity_type == "cable_cut":
        await _execute_cable_cut(action, entity_id, payload, db)
    elif entity_type == "infrastructure":
        await _execute_infrastructure(action, entity_id, payload, db)
    # "other" type has no auto-execution — requires manual handling


async def _execute_tj(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    if action == "create":
        unique_id = await _next_tj_id(db)

        # Map Android box_type values to backend values
        _BOX_TYPE_MAP = {
            "home": "home_tj", "regular": "regular_tj",
            "enclosure": "enclosure", "dome": "dome",
            "home_tj": "home_tj", "regular_tj": "regular_tj",
        }
        box_type_raw = payload.get("box_type", "regular_tj")
        box_type = _BOX_TYPE_MAP.get(box_type_raw, box_type_raw)

        # Calculate capacity from tray_count if not explicitly provided
        tray_count = payload.get("tray_count", 1)
        splice_per_tray = payload.get("splice_per_tray", 12)
        capacity = payload.get("capacity") or (tray_count * splice_per_tray)

        box = TjBox(
            unique_id=unique_id,
            name=payload.get("name", ""),
            box_type=box_type,
            tj_port=payload.get("tj_port", 8),
            capacity=capacity,
            tray_count=tray_count,
            lat=payload.get("lat", 0),
            lng=payload.get("lng", 0),
            address=payload.get("address", ""),
            notes=payload.get("notes", ""),
        )
        db.add(box)
        await db.flush()  # get the ID for splitter linking

        # If the Android submission included splitter info, create a Splitter too
        if payload.get("has_splitter"):
            ratio_str = str(payload.get("splitter_ratio", "1:4"))
            try:
                split_ratio = int(ratio_str.split(":")[-1]) if ":" in ratio_str else int(ratio_str)
            except (ValueError, IndexError):
                split_ratio = 4
            sp_id = await _next_sp_id(db)
            splitter = Splitter(
                unique_id=sp_id,
                name=f"{unique_id} Splitter",
                split_ratio=split_ratio,
                tj_box_id=box.id,
                input_core=0,
                output_cores="",
                lat=payload.get("lat", 0),
                lng=payload.get("lng", 0),
                notes="",
            )
            db.add(splitter)

        # Move pending photos from approval upload into field-photos system
        await _finalize_pending_tj_photos(unique_id, db)
    elif action == "update" and entity_id:
        result = await db.execute(select(TjBox).where(TjBox.id == entity_id))
        box = result.scalar_one_or_none()
        if not box:
            raise HTTPException(404, "TJ Box not found")
        for k, v in payload.items():
            if hasattr(box, k) and v is not None:
                setattr(box, k, v)
    elif action == "delete" and entity_id:
        result = await db.execute(select(TjBox).where(TjBox.id == entity_id))
        box = result.scalar_one_or_none()
        if not box:
            raise HTTPException(404, "TJ Box not found")
        await db.delete(box)


async def _execute_tj_splitter(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    """Execute a combined TJ + Splitter creation (atomic)."""
    tj_data = payload.get("tj", {})
    splitter_data = payload.get("splitter", {})

    if action == "create":
        # Create TJ first
        unique_id = await _next_tj_id(db)
        box = TjBox(
            unique_id=unique_id,
            name=tj_data.get("name", ""),
            box_type=tj_data.get("box_type", "regular_tj"),
            tj_port=tj_data.get("tj_port", 8),
            capacity=tj_data.get("capacity", 12),
            tray_count=tj_data.get("tray_count", 1),
            lat=tj_data.get("lat", 0),
            lng=tj_data.get("lng", 0),
            address=tj_data.get("address", ""),
            notes=tj_data.get("notes", ""),
        )
        db.add(box)
        await db.flush()  # get the ID

        # Create splitter referencing the new TJ
        sp_id = await _next_sp_id(db)
        splitter = Splitter(
            unique_id=sp_id,
            name=splitter_data.get("name", ""),
            split_ratio=splitter_data.get("split_ratio", 2),
            tj_box_id=box.id,
            input_core=splitter_data.get("input_core", 0),
            output_cores=splitter_data.get("output_cores", ""),
            lat=splitter_data.get("lat", tj_data.get("lat", 0)),
            lng=splitter_data.get("lng", tj_data.get("lng", 0)),
            notes=splitter_data.get("notes", ""),
        )
        db.add(splitter)
    else:
        raise HTTPException(400, "TJ+Splitter only supports 'create' action")


async def _execute_cable(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    if action == "create":
        link_id = await _next_link_id(db)
        cable = Cable(
            link_id=link_id,
            link_name=payload.get("link_name", ""),
            code=payload.get("code", ""),
            core_count=payload.get("core_count", 12),
            manufacturer=payload.get("manufacturer", ""),
            manufacturing_year=payload.get("manufacturing_year", 0),
            cable_type=payload.get("cable_type", "round"),
            route_type=payload.get("route_type", "driving"),
            src_tj_id=payload.get("src_tj_id"),
            dst_tj_id=payload.get("dst_tj_id"),
            notes=payload.get("notes", ""),
        )
        db.add(cable)
        await db.flush()
        segments = payload.get("segments", [])
        for i, seg in enumerate(segments):
            db.add(CableSegment(
                cable_id=cable.id,
                start_lat=seg.get("start_lat", 0),
                start_lng=seg.get("start_lng", 0),
                end_lat=seg.get("end_lat", 0),
                end_lng=seg.get("end_lng", 0),
                order_index=seg.get("order_index", i),
            ))
    elif action == "update" and entity_id:
        result = await db.execute(select(Cable).where(Cable.id == entity_id))
        cable = result.scalar_one_or_none()
        if not cable:
            raise HTTPException(404, "Cable not found")
        for k, v in payload.items():
            if k != "segments" and hasattr(cable, k) and v is not None:
                setattr(cable, k, v)
    elif action == "delete" and entity_id:
        result = await db.execute(select(Cable).where(Cable.id == entity_id))
        cable = result.scalar_one_or_none()
        if not cable:
            raise HTTPException(404, "Cable not found")
        await db.delete(cable)


async def _execute_splitter(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    if action == "create":
        unique_id = await _next_sp_id(db)
        splitter = Splitter(
            unique_id=unique_id,
            name=payload.get("name", ""),
            split_ratio=payload.get("split_ratio", 2),
            tj_box_id=payload.get("tj_box_id"),
            input_core=payload.get("input_core", 0),
            output_cores=payload.get("output_cores", ""),
            lat=payload.get("lat", 0),
            lng=payload.get("lng", 0),
            notes=payload.get("notes", ""),
        )
        db.add(splitter)
    elif action == "update" and entity_id:
        result = await db.execute(select(Splitter).where(Splitter.id == entity_id))
        splitter = result.scalar_one_or_none()
        if not splitter:
            raise HTTPException(404, "Splitter not found")
        for k, v in payload.items():
            if hasattr(splitter, k) and v is not None:
                setattr(splitter, k, v)
    elif action == "delete" and entity_id:
        result = await db.execute(select(Splitter).where(Splitter.id == entity_id))
        splitter = result.scalar_one_or_none()
        if not splitter:
            raise HTTPException(404, "Splitter not found")
        await db.delete(splitter)


async def _execute_user(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    """Approve a subscriber/user submission — update existing ONU with customer data."""
    if action == "create":
        subscriber_id = payload.get("subscriber_id")
        if not subscriber_id:
            logger.warning("User create approval missing subscriber_id — skipping")
            return

        onu = await db.get(Onu, int(subscriber_id))
        if not onu:
            logger.warning("User create approval: ONU #%s not found — skipping", subscriber_id)
            return

        for k in ("name", "phone", "address", "landmark", "gps_lat", "gps_lng", "gps_accuracy"):
            if k in payload and payload[k] is not None:
                setattr(onu, k, payload[k])

        logger.info("User submission approved: ONU #%d (%s) updated", onu.id, onu.subscriber)
    elif action == "update" and entity_id:
        result = await db.execute(select(Onu).where(Onu.id == entity_id))
        onu = result.scalar_one_or_none()
        if onu:
            for k in ("name", "address", "phone", "mobile2", "email", "gps_lat", "gps_lng",
                       "govt_id_type", "govt_id_number", "dob", "landmark"):
                if k in payload and payload[k] is not None:
                    setattr(onu, k, payload[k])


async def _execute_user_location(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    """Approve a GPS location update for a subscriber."""
    if entity_id:
        result = await db.execute(select(Onu).where(Onu.id == entity_id))
        onu = result.scalar_one_or_none()
        if onu:
            onu.gps_lat = payload.get("new_lat", onu.gps_lat)
            onu.gps_lng = payload.get("new_lng", onu.gps_lng)
            if payload.get("address"):
                onu.address = payload["address"]
    elif payload.get("onu_id"):
        result = await db.execute(select(Onu).where(Onu.id == payload["onu_id"]))
        onu = result.scalar_one_or_none()
        if onu:
            onu.gps_lat = payload.get("new_lat", onu.gps_lat)
            onu.gps_lng = payload.get("new_lng", onu.gps_lng)


async def _execute_loop(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    if action == "create":
        loop = FiberLoop(
            cable_id=payload["cable_id"],
            segment_index=payload.get("segment_index", 0),
            lat=payload.get("lat", 0),
            lng=payload.get("lng", 0),
            loop_length_m=payload.get("loop_length_m", 0),
            notes=payload.get("notes", ""),
        )
        db.add(loop)
    elif action == "update" and entity_id:
        result = await db.execute(select(FiberLoop).where(FiberLoop.id == entity_id))
        loop = result.scalar_one_or_none()
        if not loop:
            raise HTTPException(404, "Fiber loop not found")
        for k, v in payload.items():
            if hasattr(loop, k) and v is not None:
                setattr(loop, k, v)
    elif action == "delete" and entity_id:
        result = await db.execute(select(FiberLoop).where(FiberLoop.id == entity_id))
        loop = result.scalar_one_or_none()
        if not loop:
            raise HTTPException(404, "Fiber loop not found")
        await db.delete(loop)


async def _execute_cable_cut(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    if action == "create":
        cut = CableCut(
            cable_id=payload["cable_id"],
            lat=payload.get("lat", 0),
            lng=payload.get("lng", 0),
            status=payload.get("status", "cut"),
            notes=payload.get("notes", ""),
        )
        db.add(cut)
    elif action == "update" and entity_id:
        result = await db.execute(select(CableCut).where(CableCut.id == entity_id))
        cut = result.scalar_one_or_none()
        if not cut:
            raise HTTPException(404, "Cable cut not found")
        for k, v in payload.items():
            if hasattr(cut, k) and v is not None:
                setattr(cut, k, v)


async def _execute_infrastructure(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    """Generic infrastructure — create as TJ box by default, or log for manual handling."""
    infra_type = payload.get("infrastructure_type", "")
    if infra_type in ("tj", "enclosure", "dome", "splice_box"):
        await _execute_tj(action, entity_id, payload, db)
    elif infra_type == "splitter":
        await _execute_splitter(action, entity_id, payload, db)
    else:
        logger.info("Infrastructure submission approved (type=%s) — manual handling required: %s", infra_type, payload.get("name", ""))
