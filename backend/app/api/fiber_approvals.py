"""Fiber infrastructure approval workflow for field_team submissions.

Field team members can submit fiber infrastructure changes (create/update/delete)
that require admin/global_write approval before taking effect.
"""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    Cable, CableSegment, FiberApprovalRequest, FiberLoop, Splice, Splitter, TjBox,
    ApprovalStatus, CableCut,
)
from ..schemas import (
    CableCreate, CableOut, CableUpdate, FiberLoopCreate, FiberLoopOut,
    SpliceCreate, SpliceOut, SplitterCreate, SplitterOut,
    TjBoxCreate, TjBoxOut, TjBoxUpdate, CableCutCreate, CableCutOut,
)
from ..security import get_current_user, require_fiber_request, require_write, user_role
from ..utils.time import utcnow

router = APIRouter(prefix="/api/fiber", tags=["fiber-approvals"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ApprovalSubmit(BaseModel):
    action: str  # create | update | delete
    entity_type: str  # cable | tj_box | splitter | splice | loop | cable_cut
    entity_id: int | None = None
    payload: dict  # the create/update body


class ApprovalReview(BaseModel):
    review_note: str = ""


class ApprovalOut(BaseModel):
    id: int
    requested_by: int
    action: str
    entity_type: str
    entity_id: int | None = None
    payload: dict
    status: str
    reviewed_by: int | None = None
    review_note: str = ""
    created_at: datetime
    reviewed_at: datetime | None = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _next_tj_id(db) -> str:
    """Generate next TJ-XXXX ID."""
    result = db.execute(select(TjBox.unique_id).order_by(TjBox.id.desc()).limit(1))
    last = result.scalar_one_or_none()
    if last:
        try:
            num = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            num = 5001
    else:
        num = 5001
    return f"TJ-{num:04d}"


def _next_sp_id(db) -> str:
    """Generate next SP-XXXX ID."""
    result = db.execute(select(Splitter.unique_id).order_by(Splitter.id.desc()).limit(1))
    last = result.scalar_one_or_none()
    if last:
        try:
            num = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            num = 1001
    else:
        num = 1001
    return f"SP-{num:04d}"


def _next_link_id(db) -> str:
    """Generate next LINK-XXXX ID."""
    result = db.execute(select(Cable.link_id).order_by(Cable.id.desc()).limit(1))
    last = result.scalar_one_or_none()
    if last:
        try:
            num = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            num = 1001
    else:
        num = 1001
    return f"LINK-{num:04d}"


# ---------------------------------------------------------------------------
# Submit approval request (field_team + admin/global_write)
# ---------------------------------------------------------------------------

@router.post("/approvals", response_model=ApprovalOut, status_code=201)
async def submit_approval(
    body: ApprovalSubmit,
    user=Depends(require_fiber_request),
    db: AsyncSession = Depends(get_db),
):
    """Field team submits a fiber infrastructure change for NOC/admin approval."""
    valid_entity_types = {"cable", "tj_box", "splitter", "splice", "loop", "cable_cut"}
    valid_actions = {"create", "update", "delete"}

    if body.action not in valid_actions:
        raise HTTPException(400, f"Invalid action: {body.action}. Must be one of {valid_actions}")
    if body.entity_type not in valid_entity_types:
        raise HTTPException(400, f"Invalid entity_type: {body.entity_type}. Must be one of {valid_entity_types}")

    req = FiberApprovalRequest(
        requested_by=user.id,
        action=body.action,
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        payload_json=json.dumps(body.payload),
        status=ApprovalStatus.pending.value,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    return ApprovalOut(
        id=req.id,
        requested_by=req.requested_by,
        action=req.action,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        payload=json.loads(req.payload_json),
        status=req.status,
        reviewed_by=req.reviewed_by,
        review_note=req.review_note,
        created_at=req.created_at,
        reviewed_at=req.reviewed_at,
    )


# ---------------------------------------------------------------------------
# List approval requests
# ---------------------------------------------------------------------------

@router.get("/approvals", response_model=list[ApprovalOut])
async def list_approvals(
    status: str | None = None,
    entity_type: str | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List approval requests. Admin sees all; field_team sees only their own."""
    q = select(FiberApprovalRequest)

    role = user_role(user)
    if role in ("field_team",):
        q = q.where(FiberApprovalRequest.requested_by == user.id)

    if status:
        q = q.where(FiberApprovalRequest.status == status)
    if entity_type:
        q = q.where(FiberApprovalRequest.entity_type == entity_type)

    q = q.order_by(FiberApprovalRequest.created_at.desc())
    result = await db.execute(q)
    rows = result.scalars().all()

    return [
        ApprovalOut(
            id=r.id,
            requested_by=r.requested_by,
            action=r.action,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            payload=json.loads(r.payload_json),
            status=r.status,
            reviewed_by=r.reviewed_by,
            review_note=r.review_note,
            created_at=r.created_at,
            reviewed_at=r.reviewed_at,
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Get single approval request
# ---------------------------------------------------------------------------

@router.get("/approvals/{request_id}", response_model=ApprovalOut)
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

    return ApprovalOut(
        id=req.id,
        requested_by=req.requested_by,
        action=req.action,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        payload=json.loads(req.payload_json),
        status=req.status,
        reviewed_by=req.reviewed_by,
        review_note=req.review_note,
        created_at=req.created_at,
        reviewed_at=req.reviewed_at,
    )


# ---------------------------------------------------------------------------
# Approve a request
# ---------------------------------------------------------------------------

@router.put("/approvals/{request_id}/approve", response_model=ApprovalOut)
async def approve_request(
    request_id: int,
    body: ApprovalReview = ApprovalReview(),
    user=Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Admin/global_write approves a pending fiber change request and executes it."""
    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Approval request not found")
    if req.status != ApprovalStatus.pending.value:
        raise HTTPException(400, f"Request is already {req.status}")

    payload = json.loads(req.payload_json)

    # Execute the action
    try:
        if req.entity_type == "tj_box":
            await _execute_tj_box(req.action, req.entity_id, payload, db)
        elif req.entity_type == "cable":
            await _execute_cable(req.action, req.entity_id, payload, db)
        elif req.entity_type == "splitter":
            await _execute_splitter(req.action, req.entity_id, payload, db)
        elif req.entity_type == "splice":
            await _execute_splice(req.action, req.entity_id, payload, db)
        elif req.entity_type == "loop":
            await _execute_loop(req.action, req.entity_id, payload, db)
        elif req.entity_type == "cable_cut":
            await _execute_cable_cut(req.action, req.entity_id, payload, db)
        else:
            raise HTTPException(400, f"Unknown entity_type: {req.entity_type}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to execute: {str(e)}")

    req.status = ApprovalStatus.approved.value
    req.reviewed_by = user.id
    req.review_note = body.review_note
    req.reviewed_at = utcnow()
    await db.commit()
    await db.refresh(req)

    return ApprovalOut(
        id=req.id,
        requested_by=req.requested_by,
        action=req.action,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        payload=json.loads(req.payload_json),
        status=req.status,
        reviewed_by=req.reviewed_by,
        review_note=req.review_note,
        created_at=req.created_at,
        reviewed_at=req.reviewed_at,
    )


# ---------------------------------------------------------------------------
# Reject a request
# ---------------------------------------------------------------------------

@router.put("/approvals/{request_id}/reject", response_model=ApprovalOut)
async def reject_request(
    request_id: int,
    body: ApprovalReview = ApprovalReview(),
    user=Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FiberApprovalRequest).where(FiberApprovalRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Approval request not found")
    if req.status != ApprovalStatus.pending.value:
        raise HTTPException(400, f"Request is already {req.status}")

    req.status = ApprovalStatus.rejected.value
    req.reviewed_by = user.id
    req.review_note = body.review_note
    req.reviewed_at = utcnow()
    await db.commit()
    await db.refresh(req)

    return ApprovalOut(
        id=req.id,
        requested_by=req.requested_by,
        action=req.action,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        payload=json.loads(req.payload_json),
        status=req.status,
        reviewed_by=req.reviewed_by,
        review_note=req.review_note,
        created_at=req.created_at,
        reviewed_at=req.reviewed_at,
    )


# ---------------------------------------------------------------------------
# Execute helpers
# ---------------------------------------------------------------------------

async def _execute_tj_box(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    if action == "create":
        unique_id = _next_tj_id(db)
        box = TjBox(
            unique_id=unique_id,
            name=payload.get("name", ""),
            box_type=payload.get("box_type", "tj"),
            tj_port=payload.get("tj_port", 4),
            capacity=payload.get("capacity", 4),
            tray_count=payload.get("tray_count", 1),
            lat=payload.get("lat", 0),
            lng=payload.get("lng", 0),
            address=payload.get("address", ""),
            notes=payload.get("notes", ""),
        )
        db.add(box)
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


async def _execute_cable(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    if action == "create":
        link_id = _next_link_id(db)
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
        unique_id = _next_sp_id(db)
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


async def _execute_splice(action: str, entity_id: int | None, payload: dict, db: AsyncSession):
    if action == "create":
        splice = Splice(
            tj_id=payload["tj_id"],
            cable_a_id=payload["cable_a_id"],
            core_a=payload["core_a"],
            cable_b_id=payload["cable_b_id"],
            core_b=payload["core_b"],
            status=payload.get("status", "active"),
            notes=payload.get("notes", ""),
        )
        db.add(splice)
    elif action == "update" and entity_id:
        result = await db.execute(select(Splice).where(Splice.id == entity_id))
        splice = result.scalar_one_or_none()
        if not splice:
            raise HTTPException(404, "Splice not found")
        for k, v in payload.items():
            if hasattr(splice, k) and v is not None:
                setattr(splice, k, v)
    elif action == "delete" and entity_id:
        result = await db.execute(select(Splice).where(Splice.id == entity_id))
        splice = result.scalar_one_or_none()
        if not splice:
            raise HTTPException(404, "Splice not found")
        await db.delete(splice)


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
    elif action == "delete" and entity_id:
        result = await db.execute(select(CableCut).where(CableCut.id == entity_id))
        cut = result.scalar_one_or_none()
        if not cut:
            raise HTTPException(404, "Cable cut not found")
        await db.delete(cut)
