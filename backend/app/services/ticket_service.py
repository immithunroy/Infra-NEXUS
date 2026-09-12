"""Ticket business logic — extracted from route handlers for testability."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, case, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Ticket, TicketComment, TicketActivity, TicketTemplate,
    TicketStatus, TicketPriority, TicketCategory, TicketDepartment,
    User, UserRole,
)
from ..schemas import (
    TicketCreate, TicketUpdate, TicketOut, TicketCommentCreate, TicketCommentOut,
    TicketActivityOut, TicketTemplateCreate, TicketTemplateOut,
    TicketBulkUpdate, TicketAnalytics,
)
from ..security import user_role
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.tickets")

# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_status(v: str | None, default: str = TicketStatus.open.value) -> str:
    if v is None:
        return default
    try:
        return TicketStatus(v).value
    except ValueError:
        raise ValueError(f"Unknown status: {v}")


def _validate_priority(v: str | None, default: str = TicketPriority.normal.value) -> str:
    if v is None:
        return default
    try:
        return TicketPriority(v).value
    except ValueError:
        raise ValueError(f"Unknown priority: {v}")


def _validate_category(v: str | None) -> str:
    if not v:
        return ""
    try:
        return TicketCategory(v).value
    except ValueError:
        raise ValueError(f"Unknown category: {v}")


def _validate_department(v: str | None) -> str:
    if not v:
        return ""
    try:
        return TicketDepartment(v).value
    except ValueError:
        raise ValueError(f"Unknown department: {v}")


# ---------------------------------------------------------------------------
# User name resolution
# ---------------------------------------------------------------------------

async def _resolve_names(db: AsyncSession, user_ids: set[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    return {u.id: u.username for u in rows}


# ---------------------------------------------------------------------------
# Ticket → schema conversion
# ---------------------------------------------------------------------------

async def to_out(db: AsyncSession, t: Ticket, comment_count: int = 0) -> TicketOut:
    names = await _resolve_names(db, {t.assigned_to, t.created_by} - {None})
    return TicketOut(
        id=t.id,
        title=t.title,
        description=t.description,
        status=t.status,
        priority=t.priority,
        category=t.category or "",
        department=t.department or "",
        tags=t.tags or "",
        assigned_to=t.assigned_to,
        assigned_name=names.get(t.assigned_to, "") if t.assigned_to else "",
        created_by=t.created_by,
        created_by_name=names.get(t.created_by, "") if t.created_by else "",
        subscriber=t.subscriber or "",
        onu_id=t.onu_id,
        created_at=t.created_at,
        updated_at=t.updated_at,
        resolved_at=t.resolved_at,
        first_response_at=t.first_response_at,
        due_at=t.due_at,
        expected_at=t.expected_at,
        is_asap=t.is_asap or False,
        customer_satisfaction=t.customer_satisfaction,
        is_reopened=t.is_reopened or False,
        comment_count=comment_count,
        phone1=getattr(t, "phone1", "") or "",
        phone2=getattr(t, "phone2", "") or "",
    )


# ---------------------------------------------------------------------------
# Activity logging
# ---------------------------------------------------------------------------

async def log_activity(
    db: AsyncSession,
    ticket_id: int,
    user_id: int | None,
    action: str,
    field: str = "",
    old_value: str = "",
    new_value: str = "",
) -> None:
    db.add(TicketActivity(
        ticket_id=ticket_id,
        user_id=user_id,
        action=action,
        field=field,
        old_value=str(old_value),
        new_value=str(new_value),
    ))


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def list_tickets(
    db: AsyncSession,
    *,
    user: User,
    status: str | None = None,
    priority: str | None = None,
    category: str | None = None,
    department: str | None = None,
    assigned_to: int | None = None,
    search: str = "",
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[TicketOut], int]:
    """Return (tickets, total_count) with filtering, search, sorting, pagination."""
    q = select(Ticket)
    count_q = select(func.count(Ticket.id))

    # Role-based visibility
    role = user_role(user)
    if role != UserRole.admin.value:
        q = q.where(Ticket.assigned_to == user.id)
        count_q = count_q.where(Ticket.assigned_to == user.id)

    # Filters
    if status:
        q = q.where(Ticket.status == status)
        count_q = count_q.where(Ticket.status == status)
    if priority:
        q = q.where(Ticket.priority == priority)
        count_q = count_q.where(Ticket.priority == priority)
    if category:
        q = q.where(Ticket.category == category)
        count_q = count_q.where(Ticket.category == category)
    if department:
        q = q.where(Ticket.department == department)
        count_q = count_q.where(Ticket.department == department)
    if assigned_to is not None:
        q = q.where(Ticket.assigned_to == assigned_to)
        count_q = count_q.where(Ticket.assigned_to == assigned_to)

    # Search
    if search:
        like = f"%{search}%"
        search_filter = or_(
            Ticket.title.ilike(like),
            Ticket.description.ilike(like),
            Ticket.subscriber.ilike(like),
            Ticket.tags.ilike(like),
        )
        q = q.where(search_filter)
        count_q = count_q.where(search_filter)

    # Total count
    total = (await db.execute(count_q)).scalar() or 0

    # Sorting
    sort_col = getattr(Ticket, sort_by, Ticket.created_at)
    if sort_dir == "asc":
        q = q.order_by(sort_col.asc())
    else:
        q = q.order_by(sort_col.desc())

    # Pagination
    offset = (max(page, 1) - 1) * page_size
    q = q.offset(offset).limit(page_size)

    rows = (await db.execute(q)).scalars().all()

    # Batch comment counts
    ticket_ids = [t.id for t in rows]
    comment_counts: dict[int, int] = {}
    if ticket_ids:
        cc_rows = (
            await db.execute(
                select(TicketComment.ticket_id, func.count(TicketComment.id))
                .where(TicketComment.ticket_id.in_(ticket_ids))
                .group_by(TicketComment.ticket_id)
            )
        ).all()
        comment_counts = {row[0]: row[1] for row in cc_rows}

    out = []
    for t in rows:
        out.append(await to_out(db, t, comment_counts.get(t.id, 0)))
    return out, total


async def get_ticket(db: AsyncSession, ticket_id: int) -> Ticket | None:
    return await db.get(Ticket, ticket_id)


async def create_ticket(db: AsyncSession, body: TicketCreate, user: User) -> Ticket:
    ticket = Ticket(
        title=body.title.strip(),
        description=body.description,
        priority=_validate_priority(body.priority),
        category=_validate_category(body.category),
        department=_validate_department(body.department),
        tags=body.tags or "",
        assigned_to=body.assigned_to,
        created_by=user.id,
        subscriber=body.subscriber or "",
        onu_id=body.onu_id,
        due_at=body.due_at,
        expected_at=body.expected_at,
        is_asap=body.is_asap,
        phone1=body.phone1 or "",
        phone2=body.phone2 or "",
    )
    db.add(ticket)
    await db.flush()
    await log_activity(db, ticket.id, user.id, "created")
    if body.assigned_to:
        await log_activity(db, ticket.id, user.id, "assigned", "assigned_to", "", str(body.assigned_to))
    return ticket


async def update_ticket(
    db: AsyncSession, ticket: Ticket, body: TicketUpdate, user: User
) -> Ticket:
    role = user_role(user)
    is_admin = role == UserRole.admin.value
    is_assignee = ticket.assigned_to == user.id
    can_write = role in (UserRole.admin.value, UserRole.global_write.value)

    data = body.model_dump(exclude_unset=True)

    # Field-level permission checks
    if "assigned_to" in data and not is_admin:
        raise PermissionError("Only admins can reassign tickets")
    if "onu_id" in data and not can_write:
        raise PermissionError("Only admins/global-write can relink a subscriber")
    if "title" in data and not can_write:
        raise PermissionError("Only admins/global-write can change the title")

    # Track changes for activity log
    for field in ["title", "description", "priority", "category", "department", "tags", "subscriber", "onu_id"]:
        if field in data:
            old_val = getattr(ticket, field, "")
            new_val = data[field]
            if field == "title":
                new_val = (new_val or "").strip() or old_val
            if field == "subscriber":
                new_val = new_val or ""
            if str(old_val) != str(new_val):
                await log_activity(db, ticket.id, user.id, "updated", field, old_val, new_val)
                setattr(ticket, field, new_val)

    if "status" in data:
        new_status = _validate_status(data["status"], ticket.status)
        if new_status != ticket.status:
            old_status = ticket.status
            ticket.status = new_status
            await log_activity(db, ticket.id, user.id, "status_change", "status", old_status, new_status)

            # Auto-set resolved_at
            if new_status in (TicketStatus.resolved.value, TicketStatus.closed.value):
                if ticket.resolved_at is None:
                    ticket.resolved_at = utcnow()
            elif new_status in (TicketStatus.open.value, TicketStatus.in_progress.value):
                if ticket.resolved_at is not None:
                    await log_activity(db, ticket.id, user.id, "reopened", "status", old_status, new_status)
                    ticket.is_reopened = True
                ticket.resolved_at = None

            # Track first response time
            if ticket.first_response_at is None and new_status == TicketStatus.in_progress.value:
                ticket.first_response_at = utcnow()
                await log_activity(db, ticket.id, user.id, "first_response", "status", old_status, new_status)

    if "priority" in data:
        new_prio = _validate_priority(data["priority"], ticket.priority)
        if new_prio != ticket.priority:
            await log_activity(db, ticket.id, user.id, "updated", "priority", ticket.priority, new_prio)
            ticket.priority = new_prio

    if "assigned_to" in data and is_admin:
        old_assignee = str(ticket.assigned_to or "")
        new_assignee = str(data["assigned_to"] or "")
        if old_assignee != new_assignee:
            if data["assigned_to"] is not None:
                assignee = await db.get(User, data["assigned_to"])
                if assignee is None:
                    raise ValueError("Assigned user not found")
            ticket.assigned_to = data["assigned_to"]
            await log_activity(db, ticket.id, user.id, "assigned", "assigned_to", old_assignee, new_assignee)

    if "due_at" in data:
        old_due = str(ticket.due_at or "")
        new_due = str(data["due_at"] or "")
        if old_due != new_due:
            ticket.due_at = data["due_at"]
            await log_activity(db, ticket.id, user.id, "updated", "due_at", old_due, new_due)

    if "customer_satisfaction" in data and data["customer_satisfaction"] is not None:
        old_cs = str(ticket.customer_satisfaction or "")
        new_cs = str(data["customer_satisfaction"])
        if old_cs != new_cs:
            ticket.customer_satisfaction = data["customer_satisfaction"]
            await log_activity(db, ticket.id, user.id, "rated", "customer_satisfaction", old_cs, new_cs)

    if "expected_at" in data:
        old_ea = str(ticket.expected_at or "")
        new_ea = str(data["expected_at"] or "")
        if old_ea != new_ea:
            ticket.expected_at = data["expected_at"]
            await log_activity(db, ticket.id, user.id, "updated", "expected_at", old_ea, new_ea)

    if "is_asap" in data and data["is_asap"] is not None:
        old_asap = str(ticket.is_asap)
        new_asap = str(data["is_asap"])
        if old_asap != new_asap:
            ticket.is_asap = data["is_asap"]
            await log_activity(db, ticket.id, user.id, "updated", "is_asap", old_asap, new_asap)

    if "phone1" in data:
        old_p = ticket.phone1 or ""
        new_p = data["phone1"] or ""
        if old_p != new_p:
            ticket.phone1 = new_p
            await log_activity(db, ticket.id, user.id, "updated", "phone1", old_p, new_p)

    if "phone2" in data:
        old_p = ticket.phone2 or ""
        new_p = data["phone2"] or ""
        if old_p != new_p:
            ticket.phone2 = new_p
            await log_activity(db, ticket.id, user.id, "updated", "phone2", old_p, new_p)

    return ticket


async def close_ticket(db: AsyncSession, ticket: Ticket, user: User) -> Ticket:
    """Close a ticket — cannot be deleted, only closed."""
    if ticket.status == TicketStatus.closed.value:
        return ticket
    old_status = ticket.status
    ticket.status = TicketStatus.closed.value
    ticket.resolved_at = utcnow()
    await log_activity(db, ticket.id, user.id, "status_change", "status", old_status, TicketStatus.closed.value)
    return ticket


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

async def list_comments(db: AsyncSession, ticket_id: int) -> list[TicketCommentOut]:
    rows = (
        await db.execute(
            select(TicketComment)
            .where(TicketComment.ticket_id == ticket_id)
            .order_by(TicketComment.created_at.asc())
        )
    ).scalars().all()
    user_ids = {c.user_id for c in rows} - {None}
    names = await _resolve_names(db, user_ids)
    return [
        TicketCommentOut(
            id=c.id,
            ticket_id=c.ticket_id,
            user_id=c.user_id,
            user_name=names.get(c.user_id, "") if c.user_id else "",
            body=c.body,
            is_internal=c.is_internal,
            created_at=c.created_at,
        )
        for c in rows
    ]


async def create_comment(
    db: AsyncSession, ticket_id: int, body: TicketCommentCreate, user: User
) -> TicketComment:
    comment = TicketComment(
        ticket_id=ticket_id,
        user_id=user.id,
        body=body.body,
        is_internal=body.is_internal,
    )
    db.add(comment)
    await db.flush()
    await log_activity(db, ticket_id, user.id, "commented", "comment", "", body.body[:200])
    return comment


# ---------------------------------------------------------------------------
# Activity log
# ---------------------------------------------------------------------------

async def list_activities(db: AsyncSession, ticket_id: int) -> list[TicketActivityOut]:
    rows = (
        await db.execute(
            select(TicketActivity)
            .where(TicketActivity.ticket_id == ticket_id)
            .order_by(TicketActivity.created_at.desc())
            .limit(100)
        )
    ).scalars().all()
    user_ids = {a.user_id for a in rows} - {None}
    names = await _resolve_names(db, user_ids)
    return [
        TicketActivityOut(
            id=a.id,
            ticket_id=a.ticket_id,
            user_id=a.user_id,
            user_name=names.get(a.user_id, "") if a.user_id else "",
            action=a.action,
            field=a.field,
            old_value=a.old_value,
            new_value=a.new_value,
            created_at=a.created_at,
        )
        for a in rows
    ]


# ---------------------------------------------------------------------------
# Bulk operations
# ---------------------------------------------------------------------------

async def bulk_update(
    db: AsyncSession, body: TicketBulkUpdate, user: User
) -> int:
    """Update multiple tickets. Returns count of updated tickets."""
    role = user_role(user)
    is_admin = role == UserRole.admin.value
    if not is_admin:
        raise PermissionError("Only admins can perform bulk updates")

    q = select(Ticket).where(Ticket.id.in_(body.ticket_ids))
    rows = (await db.execute(q)).scalars().all()
    count = 0
    for ticket in rows:
        if body.status:
            ticket.status = _validate_status(body.status, ticket.status)
        if body.priority:
            ticket.priority = _validate_priority(body.priority, ticket.priority)
        if body.assigned_to is not None:
            ticket.assigned_to = body.assigned_to
        if body.category is not None:
            ticket.category = _validate_category(body.category)
        if body.department is not None:
            ticket.department = _validate_department(body.department)
        await log_activity(db, ticket.id, user.id, "bulk_updated", "", "", f"bulk:{body.ticket_ids}")
        count += 1
    return count


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

async def list_templates(db: AsyncSession, user: User) -> list[TicketTemplateOut]:
    rows = (await db.execute(select(TicketTemplate).order_by(TicketTemplate.name))).scalars().all()
    return [
        TicketTemplateOut(
            id=t.id, name=t.name, title=t.title, description=t.description,
            priority=t.priority, category=t.category, department=t.department,
            created_by=t.created_by, created_at=t.created_at,
        )
        for t in rows
    ]


async def create_template(
    db: AsyncSession, body: TicketTemplateCreate, user: User
) -> TicketTemplate:
    tmpl = TicketTemplate(
        name=body.name,
        title=body.title,
        description=body.description,
        priority=_validate_priority(body.priority),
        category=_validate_category(body.category),
        department=_validate_department(body.department),
        created_by=user.id,
    )
    db.add(tmpl)
    return tmpl


async def delete_template(db: AsyncSession, template_id: int) -> None:
    tmpl = await db.get(TicketTemplate, template_id)
    if tmpl is None:
        raise ValueError("Template not found")
    await db.delete(tmpl)


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

async def get_analytics(
    db: AsyncSession,
    *,
    user: User | None = None,
    days: int = 30,
) -> TicketAnalytics:
    """Aggregate ticket analytics for the dashboard."""
    since = utcnow() - timedelta(days=days)

    base_filter = [Ticket.created_at >= since]
    if user and user_role(user) != UserRole.admin.value:
        base_filter.append(Ticket.assigned_to == user.id)

    # Status counts
    status_rows = (
        await db.execute(
            select(Ticket.status, func.count(Ticket.id))
            .where(*base_filter)
            .group_by(Ticket.status)
        )
    ).all()
    status_map = {row[0]: row[1] for row in status_rows}
    total = sum(status_map.values())

    # Priority counts
    priority_rows = (
        await db.execute(
            select(Ticket.priority, func.count(Ticket.id))
            .where(*base_filter)
            .group_by(Ticket.priority)
        )
    ).all()

    # Category counts
    category_rows = (
        await db.execute(
            select(Ticket.category, func.count(Ticket.id))
            .where(*base_filter, Ticket.category != "")
            .group_by(Ticket.category)
        )
    ).all()

    # Department counts
    department_rows = (
        await db.execute(
            select(Ticket.department, func.count(Ticket.id))
            .where(*base_filter, Ticket.department != "")
            .group_by(Ticket.department)
        )
    ).all()

    # Assignee counts
    assignee_rows = (
        await db.execute(
            select(Ticket.assigned_to, func.count(Ticket.id))
            .where(*base_filter, Ticket.assigned_to.isnot(None))
            .group_by(Ticket.assigned_to)
        )
    ).all()
    assignee_ids = {row[0] for row in assignee_rows}
    assignee_names = await _resolve_names(db, assignee_ids)

    # Average response time (hours)
    avg_resp = (
        await db.execute(
            select(func.avg(
                func.extract("epoch", Ticket.first_response_at - Ticket.created_at) / 3600
            ))
            .where(*base_filter, Ticket.first_response_at.isnot(None))
        )
    ).scalar()

    # Average resolution time (hours)
    avg_res = (
        await db.execute(
            select(func.avg(
                func.extract("epoch", Ticket.resolved_at - Ticket.created_at) / 3600
            ))
            .where(*base_filter, Ticket.resolved_at.isnot(None))
        )
    ).scalar()

    # Average satisfaction
    avg_sat = (
        await db.execute(
            select(func.avg(Ticket.customer_satisfaction))
            .where(*base_filter, Ticket.customer_satisfaction.isnot(None))
        )
    ).scalar()

    # Reopened count
    reopened = (
        await db.execute(
            select(func.count(Ticket.id))
            .where(*base_filter, Ticket.is_reopened.is_(True))
        )
    ).scalar() or 0

    # Volume over time (daily)
    volume_rows = (
        await db.execute(
            select(
                func.date(Ticket.created_at).label("day"),
                func.count(Ticket.id).label("count"),
            )
            .where(*base_filter)
            .group_by(func.date(Ticket.created_at))
            .order_by(func.date(Ticket.created_at))
        )
    ).all()

    # SLA breaches (due_at < now and status not resolved/closed)
    sla_breaches = (
        await db.execute(
            select(func.count(Ticket.id))
            .where(
                *base_filter,
                Ticket.due_at.isnot(None),
                Ticket.due_at < utcnow(),
                Ticket.status.notin_([TicketStatus.resolved.value, TicketStatus.closed.value]),
            )
        )
    ).scalar() or 0

    return TicketAnalytics(
        total=total,
        open_count=status_map.get("open", 0),
        in_progress_count=status_map.get("in_progress", 0),
        resolved_count=status_map.get("resolved", 0),
        closed_count=status_map.get("closed", 0),
        sla_breaches=sla_breaches,
        avg_response_hours=round(avg_resp, 1) if avg_resp else None,
        avg_resolution_hours=round(avg_res, 1) if avg_res else None,
        avg_satisfaction=round(avg_sat, 1) if avg_sat else None,
        reopened_count=reopened,
        by_priority=[{"label": r[0], "count": r[1]} for r in priority_rows],
        by_category=[{"label": r[0] or "uncategorized", "count": r[1]} for r in category_rows],
        by_department=[{"label": r[0] or "unassigned", "count": r[1]} for r in department_rows],
        by_assignee=[
            {"label": assignee_names.get(r[0], str(r[0])), "count": r[1]}
            for r in assignee_rows
        ],
        volume_over_time=[{"date": str(r[0]), "count": r[1]} for r in volume_rows],
    )
