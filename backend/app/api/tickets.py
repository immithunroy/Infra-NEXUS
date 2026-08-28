from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Ticket, TicketPriority, TicketStatus, User, UserRole
from ..schemas import TicketCreate, TicketOut, TicketUpdate
from ..security import get_current_user, require_write, require_fiber_request, user_role

router = APIRouter(prefix="/api/tickets", tags=["tickets"], dependencies=[Depends(get_current_user)])


def _status(v: str | None, default: str = TicketStatus.open.value) -> str:
    if v is None:
        return default
    try:
        return TicketStatus(v).value
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown status: {v}")


def _priority(v: str | None, default: str = TicketPriority.normal.value) -> str:
    if v is None:
        return default
    try:
        return TicketPriority(v).value
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown priority: {v}")


async def _names(db: AsyncSession, users: list[User]) -> dict[int, str]:
    return {u.id: u.username for u in users}


@router.get("", response_model=list[TicketOut])
async def list_tickets(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """List tickets. Non-admins only see the ones assigned to them."""
    q = select(Ticket).order_by(Ticket.status, Ticket.priority, Ticket.created_at.desc())
    if user_role(user) != UserRole.admin.value:
        q = q.where(Ticket.assigned_to == user.id)
    rows = (await db.execute(q)).scalars().all()
    user_ids = {t.assigned_to for t in rows} | {t.created_by for t in rows}
    user_ids.discard(None)
    unames = {}
    if user_ids:
        us = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        unames = await _names(db, us)
    out = []
    for t in rows:
        out.append(_to_out(t, unames))
    return out


def _to_out(t: Ticket, unames: dict[int, str]) -> TicketOut:
    return TicketOut(
        id=t.id,
        title=t.title,
        description=t.description,
        status=t.status,
        priority=t.priority,
        assigned_to=t.assigned_to,
        assigned_name=unames.get(t.assigned_to, "") if t.assigned_to else "",
        created_by=t.created_by,
        created_by_name=unames.get(t.created_by, "") if t.created_by else "",
        subscriber=t.subscriber,
        onu_id=t.onu_id,
        created_at=t.created_at,
        updated_at=t.updated_at,
        resolved_at=t.resolved_at,
    )


@router.post("", response_model=TicketOut)
async def create_ticket(
    body: TicketCreate,
    user: User = Depends(require_fiber_request),
    db: AsyncSession = Depends(get_db),
):
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="title is required")
    if body.assigned_to is not None:
        assignee = await db.get(User, body.assigned_to)
        if assignee is None:
            raise HTTPException(status_code=404, detail="Assigned user not found")
    ticket = Ticket(
        title=body.title.strip(),
        description=body.description,
        priority=_priority(body.priority),
        assigned_to=body.assigned_to,
        created_by=user.id,
        subscriber=body.subscriber or "",
        onu_id=body.onu_id,
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)
    unames = {user.id: user.username}
    if ticket.assigned_to:
        assignee = await db.get(User, ticket.assigned_to)
        if assignee:
            unames[assignee.id] = assignee.username
    return _to_out(ticket, unames)


@router.put("/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: int,
    body: TicketUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")

    role = user_role(user)
    is_admin = role == UserRole.admin.value
    is_assignee = ticket.assigned_to == user.id
    can_write = role in (UserRole.admin.value, UserRole.global_write.value)
    if not (is_admin or is_assignee or can_write):
        raise HTTPException(status_code=403, detail="You can only update tickets assigned to you")

    data = body.model_dump(exclude_unset=True)
    if "assigned_to" in data and not is_admin:
        raise HTTPException(status_code=403, detail="Only admins can reassign tickets")
    if "onu_id" in data and not can_write:
        raise HTTPException(status_code=403, detail="Only admins/global-write can relink a subscriber")
    if "title" in data and not can_write:
        raise HTTPException(status_code=403, detail="Only admins/global-write can change the title")

    if "status" in data:
        ticket.status = _status(data["status"], ticket.status)
    if "priority" in data:
        ticket.priority = _priority(data["priority"], ticket.priority)
    if "description" in data:
        ticket.description = data["description"]
    if "title" in data and can_write:
        ticket.title = data["title"].strip() or ticket.title
    if "subscriber" in data and can_write:
        ticket.subscriber = data["subscriber"] or ""
    if "onu_id" in data and can_write:
        ticket.onu_id = data["onu_id"]
    if "assigned_to" in data and is_admin:
        if data["assigned_to"] is not None:
            assignee = await db.get(User, data["assigned_to"])
            if assignee is None:
                raise HTTPException(status_code=404, detail="Assigned user not found")
        ticket.assigned_to = data["assigned_to"]

    from ..utils.time import utcnow

    if ticket.status in (TicketStatus.resolved.value, TicketStatus.closed.value):
        if ticket.resolved_at is None:
            ticket.resolved_at = utcnow()
    elif ticket.status in (TicketStatus.open.value, TicketStatus.in_progress.value):
        ticket.resolved_at = None

    await db.commit()
    await db.refresh(ticket)
    user_ids = {ticket.assigned_to, ticket.created_by}
    user_ids.discard(None)
    unames = {}
    if user_ids:
        us = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        unames = await _names(db, us)
    return _to_out(ticket, unames)


@router.delete("/{ticket_id}", status_code=204)
async def delete_ticket(ticket_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await db.delete(ticket)
    await db.commit()
