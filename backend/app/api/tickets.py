from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from ..schemas import (
    TicketCreate, TicketOut, TicketUpdate,
    TicketCommentCreate, TicketCommentOut,
    TicketActivityOut,
    TicketTemplateCreate, TicketTemplateOut,
    TicketBulkUpdate, TicketAnalytics,
)
from ..security import get_current_user, require_write, require_fiber_request, user_role
from ..services import ticket_service as svc

router = APIRouter(prefix="/api/tickets", tags=["tickets"], dependencies=[Depends(get_current_user)])


class TicketListResponse(BaseModel):
    items: list[TicketOut]
    total: int
    page: int
    page_size: int
    pages: int


# ── List / Search / Filter ───────────────────────────────────────────────

@router.get("", response_model=TicketListResponse)
async def list_tickets(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    status: str | None = None,
    priority: str | None = None,
    category: str | None = None,
    department: str | None = None,
    assigned_to: int | None = None,
    search: str = "",
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
):
    try:
        items, total = await svc.list_tickets(
            db, user=user, status=status, priority=priority,
            category=category, department=department, assigned_to=assigned_to,
            search=search, sort_by=sort_by, sort_dir=sort_dir,
            page=page, page_size=page_size,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    pages = max(1, -(-total // page_size))  # ceil division
    return TicketListResponse(items=items, total=total, page=page, page_size=page_size, pages=pages)


# ── Get single ticket ────────────────────────────────────────────────────

@router.get("/{ticket_id}", response_model=TicketOut)
async def get_ticket(ticket_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ticket = await svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return await svc.to_out(db, ticket)


# ── Create ───────────────────────────────────────────────────────────────

@router.post("", response_model=TicketOut, status_code=201)
async def create_ticket(
    body: TicketCreate,
    user: User = Depends(require_fiber_request),
    db: AsyncSession = Depends(get_db),
):
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="title is required")
    try:
        ticket = await svc.create_ticket(db, body, user)
        await db.commit()
        await db.refresh(ticket)
        return await svc.to_out(db, ticket)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Update ───────────────────────────────────────────────────────────────

@router.put("/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: int,
    body: TicketUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    try:
        ticket = await svc.update_ticket(db, ticket, body, user)
        await db.commit()
        await db.refresh(ticket)
        return await svc.to_out(db, ticket)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Close ───────────────────────────────────────────────────────────────

@router.post("/{ticket_id}/close", response_model=TicketOut)
async def close_ticket(ticket_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    ticket = await svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ticket = await svc.close_ticket(db, ticket, user)
    await db.commit()
    await db.refresh(ticket)
    return await svc.to_out(db, ticket)


# ── Comments ─────────────────────────────────────────────────────────────

@router.get("/{ticket_id}/comments", response_model=list[TicketCommentOut])
async def list_comments(ticket_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ticket = await svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return await svc.list_comments(db, ticket_id)


@router.post("/{ticket_id}/comments", response_model=TicketCommentOut, status_code=201)
async def create_comment(
    ticket_id: int,
    body: TicketCommentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not body.body.strip():
        raise HTTPException(status_code=422, detail="body is required")
    comment = await svc.create_comment(db, ticket_id, body, user)
    await db.commit()
    await db.refresh(comment)
    names = await svc._resolve_names(db, {comment.user_id} - {None})
    return TicketCommentOut(
        id=comment.id,
        ticket_id=comment.ticket_id,
        user_id=comment.user_id,
        user_name=names.get(comment.user_id, "") if comment.user_id else "",
        body=comment.body,
        is_internal=comment.is_internal,
        created_at=comment.created_at,
    )


# ── Activity log ─────────────────────────────────────────────────────────

@router.get("/{ticket_id}/activities", response_model=list[TicketActivityOut])
async def list_activities(ticket_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ticket = await svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return await svc.list_activities(db, ticket_id)


# ── Bulk update ──────────────────────────────────────────────────────────

@router.post("/bulk-update")
async def bulk_update(
    body: TicketBulkUpdate,
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    try:
        count = await svc.bulk_update(db, body, user)
        await db.commit()
        return {"updated": count}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Templates ────────────────────────────────────────────────────────────

@router.get("/templates/list", response_model=list[TicketTemplateOut])
async def list_templates(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await svc.list_templates(db, user)


@router.post("/templates", response_model=TicketTemplateOut, status_code=201)
async def create_template(
    body: TicketTemplateCreate,
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="name is required")
    tmpl = await svc.create_template(db, body, user)
    await db.commit()
    await db.refresh(tmpl)
    return TicketTemplateOut(
        id=tmpl.id, name=tmpl.name, title=tmpl.title, description=tmpl.description,
        priority=tmpl.priority, category=tmpl.category, department=tmpl.department,
        created_by=tmpl.created_by, created_at=tmpl.created_at,
    )


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(template_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    try:
        await svc.delete_template(db, template_id)
        await db.commit()
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Analytics ────────────────────────────────────────────────────────────

@router.get("/analytics/dashboard", response_model=TicketAnalytics)
async def ticket_analytics(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    days: int = Query(30, ge=1, le=365),
):
    return await svc.get_analytics(db, user=user, days=days)
