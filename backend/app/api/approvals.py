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
    file: UploadFile = File(...),
    category: str = Form(""),
    entity_id: str = Form(""),
    user=Depends(require_approval_submit),
    db: AsyncSession = Depends(get_db),
):
    """Upload a photo for an approval submission. Returns the filename.

    When category='user' and entity_id (approval ID) is provided, the photo
    is also saved into the field-photos system so the web subscriber profile
    can display it immediately.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ext = file.filename.split(".")[-1] if file.filename else "jpg"
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = UPLOAD_DIR / filename

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(400, "File size must be less than 10MB")

    with open(filepath, "wb") as f:
        f.write(content)

    # --- Also write to field-photos system for subscriber photos ---
    if category == "user" and entity_id:
        try:
            await _migrate_photo_to_field(content, ext, int(entity_id), user, db)
            await db.commit()
        except Exception as e:
            logger.warning("Failed to write field photo for approval #%s: %s", entity_id, e)

    return {"filename": filename, "url": f"/api/approvals/photos/{filename}"}


@router.get("/photos/{filename}")
async def serve_photo(
    filename: str,
    user=Depends(get_current_user),
):
    """Serve an uploaded approval photo."""
    filepath = UPLOAD_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "Photo not found")

    import mimetypes
    media_type = mimetypes.guess_type(str(filepath))[0] or "image/jpeg"

    from fastapi.responses import FileResponse
    return FileResponse(filepath, media_type=media_type)


# ---------------------------------------------------------------------------
# Photo migration: approval photos -> field-photos system
# ---------------------------------------------------------------------------

_SUBSCRIBER_PHOTO_TYPES = ["overall", "equipment", "identification"]

_FIELD_PHOTOS_DIR = Path(os.environ.get("PHOTO_UPLOAD_DIR", "/app/uploads/field-photos"))


async def _migrate_photo_to_field(
    img_bytes: bytes, ext: str, approval_id: int, uploaded_by_user: User, db: AsyncSession,
):
    """Copy an approval-uploaded photo into the field-photos system for a subscriber."""
    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == approval_id)
    )
    req = result.scalar_one_or_none()
    if not req or req.entity_type != "user":
        return

    payload = json.loads(req.payload_json) if req.payload_json else {}
    subscriber_id = payload.get("subscriber_id")
    if not subscriber_id:
        return

    onu = await db.get(Onu, int(subscriber_id))
    if not onu or not onu.subscriber:
        return

    sub_key = onu.subscriber  # PPPoE username used as entity_id
    sub_dir = _FIELD_PHOTOS_DIR / "subscriber" / sub_key

    # Determine next available photo slot
    existing = (
        await db.execute(
            select(FieldPhoto.photo_type).where(
                and_(
                    FieldPhoto.entity_type == "subscriber",
                    FieldPhoto.entity_id == sub_key,
                )
            )
        )
    ).scalars().all()
    remaining = [t for t in _SUBSCRIBER_PHOTO_TYPES if t not in existing]
    if not remaining:
        return  # all 3 slots filled
    photo_type = remaining[0]

    filename = f"{photo_type}.jpg"
    storage_key = sub_dir / filename
    storage_key.parent.mkdir(parents=True, exist_ok=True)

    # Simple save (no watermark — approval photos are raw field captures)
    storage_key.write_bytes(img_bytes)

    rel_key = f"subscriber/{sub_key}/{filename}"
    db.add(FieldPhoto(
        entity_type="subscriber",
        entity_id=sub_key,
        photo_type=photo_type,
        storage_key=rel_key,
        original_filename=f"{photo_type}.jpg",
        mime_type="image/jpeg",
        file_size=len(img_bytes),
        uploaded_by=uploaded_by_user.id,
        captured_by=req.submitted_by_name or "",
    ))
    await db.flush()
    logger.info("Migrated approval photo -> field photo: %s (type=%s)", rel_key, photo_type)


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
