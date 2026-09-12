from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Lead, User, UserRole
from ..schemas import LeadCreate, LeadDashboard, LeadOut, LeadUpdate, MonthlySummary, UserLeadPerformance
from ..security import get_current_user, require_write, user_role
from ..utils.time import utcnow

router = APIRouter(prefix="/api/leads", tags=["leads"], dependencies=[Depends(get_current_user)])


def _to_out(lead: Lead, users: dict[int, str]) -> LeadOut:
    return LeadOut(
        id=lead.id,
        customer_name=lead.customer_name,
        mobile_primary=lead.mobile_primary,
        mobile_secondary=lead.mobile_secondary,
        road_area=lead.road_area,
        ward=lead.ward,
        package_name=lead.package_name,
        service_charge=lead.service_charge,
        lead_source=lead.lead_source,
        assigned_to=lead.assigned_to,
        assigned_to_name=users.get(lead.assigned_to, "") if lead.assigned_to else "",
        status=lead.status,
        priority=lead.priority,
        expected_connection_date=lead.expected_connection_date,
        customer_address=lead.customer_address,
        notes=lead.notes,
        latitude=lead.latitude,
        longitude=lead.longitude,
        follow_up_date=lead.follow_up_date,
        follow_up_notes=lead.follow_up_notes,
        lost_reason=lead.lost_reason,
        converted_to_subscriber=lead.converted_to_subscriber,
        converted_at=lead.converted_at,
        created_by=lead.created_by,
        created_by_name=users.get(lead.created_by, "") if lead.created_by else "",
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )


async def _user_map(db: AsyncSession) -> dict[int, str]:
    rows = (await db.execute(select(User.id, User.username))).all()
    return {r[0]: r[1] for r in rows}


# ── CRUD ────────────────────────────────────────────────────────────────


@router.get("", response_model=list[LeadOut])
async def list_leads(
    status: str | None = Query(default=None),
    assigned_to: int | None = Query(default=None),
    package_name: str | None = Query(default=None),
    ward: str | None = Query(default=None),
    lead_source: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    q: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    sort: str | None = Query(default=None),
    order: str = Query(default="asc"),
    limit: int = Query(default=200, le=2000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = user_role(user)
    is_admin = role in (UserRole.admin.value, UserRole.global_write.value)
    stmt = select(Lead)
    if not is_admin:
        stmt = stmt.where(Lead.assigned_to == user.id)
    if status:
        stmt = stmt.where(Lead.status == status)
    if assigned_to:
        stmt = stmt.where(Lead.assigned_to == assigned_to)
    if package_name:
        stmt = stmt.where(Lead.package_name == package_name)
    if ward:
        stmt = stmt.where(Lead.ward == ward)
    if lead_source:
        stmt = stmt.where(Lead.lead_source == lead_source)
    if priority:
        stmt = stmt.where(Lead.priority == priority)
    if q:
        stmt = stmt.where(
            Lead.customer_name.ilike(f"%{q}%")
            | Lead.mobile_primary.ilike(f"%{q}%")
            | Lead.road_area.ilike(f"%{q}%")
            | Lead.notes.ilike(f"%{q}%")
        )
    if date_from:
        try:
            dt = datetime.fromisoformat(date_from)
            stmt = stmt.where(Lead.created_at >= dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            stmt = stmt.where(Lead.created_at <= dt)
        except ValueError:
            pass
    sort_col = {
        "created_at": Lead.created_at,
        "updated_at": Lead.updated_at,
        "status": Lead.status,
        "priority": Lead.priority,
        "customer_name": Lead.customer_name,
        "service_charge": Lead.service_charge,
        "follow_up_date": Lead.follow_up_date,
    }.get(sort or "", Lead.created_at)
    if order == "desc":
        stmt = stmt.order_by(sort_col.desc(), Lead.id.desc())
    else:
        stmt = stmt.order_by(sort_col.asc(), Lead.id.asc())
    stmt = stmt.offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    umap = await _user_map(db)
    return [_to_out(r, umap) for r in rows]


@router.get("/count")
async def leads_count(
    status: str | None = Query(default=None),
    assigned_to: int | None = Query(default=None),
    package_name: str | None = Query(default=None),
    ward: str | None = Query(default=None),
    lead_source: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    q: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = user_role(user)
    is_admin = role in (UserRole.admin.value, UserRole.global_write.value)
    stmt = select(func.count(Lead.id))
    if not is_admin:
        stmt = stmt.where(Lead.assigned_to == user.id)
    if status:
        stmt = stmt.where(Lead.status == status)
    if assigned_to:
        stmt = stmt.where(Lead.assigned_to == assigned_to)
    if package_name:
        stmt = stmt.where(Lead.package_name == package_name)
    if ward:
        stmt = stmt.where(Lead.ward == ward)
    if lead_source:
        stmt = stmt.where(Lead.lead_source == lead_source)
    if priority:
        stmt = stmt.where(Lead.priority == priority)
    if q:
        stmt = stmt.where(
            Lead.customer_name.ilike(f"%{q}%")
            | Lead.mobile_primary.ilike(f"%{q}%")
            | Lead.road_area.ilike(f"%{q}%")
            | Lead.notes.ilike(f"%{q}%")
        )
    if date_from:
        try:
            stmt = stmt.where(Lead.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            stmt = stmt.where(Lead.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    total = (await db.execute(stmt)).scalar() or 0
    return {"total": total}


@router.get("/dashboard", response_model=LeadDashboard)
async def lead_dashboard(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = user_role(user)
    is_admin = role in (UserRole.admin.value, UserRole.global_write.value)
    base = select(Lead)
    if not is_admin:
        base = base.where(Lead.assigned_to == user.id)
    if date_from:
        try:
            base = base.where(Lead.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            base = base.where(Lead.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    rows = (await db.execute(base)).scalars().all()
    total = len(rows)
    counts: dict[str, int] = {}
    total_sc = 0.0
    for r in rows:
        counts[r.status] = counts.get(r.status, 0) + 1
        if r.status == "successful" and r.service_charge:
            total_sc += r.service_charge
    successful = counts.get("successful", 0)
    return LeadDashboard(
        total=total,
        new_count=counts.get("new", 0),
        follow_up=counts.get("follow_up", 0),
        interested=counts.get("interested", 0),
        installation_pending=counts.get("installation_pending", 0),
        successful=successful,
        lost=counts.get("lost", 0),
        conversion_rate=round(successful / total * 100, 2) if total else 0,
        total_service_charge=total_sc,
    )


@router.get("/user-performance", response_model=list[UserLeadPerformance])
async def user_performance(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = user_role(user)
    is_admin = role in (UserRole.admin.value, UserRole.global_write.value)
    base = select(Lead)
    if date_from:
        try:
            base = base.where(Lead.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            base = base.where(Lead.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    rows = (await db.execute(base)).scalars().all()
    umap = await _user_map(db)
    by_user: dict[int, dict] = {}
    for r in rows:
        uid = r.assigned_to or 0
        if uid not in by_user:
            by_user[uid] = {"total": 0, "successful": 0, "pending": 0, "lost": 0, "sc": 0.0}
        by_user[uid]["total"] += 1
        if r.status == "successful":
            by_user[uid]["successful"] += 1
            by_user[uid]["sc"] += r.service_charge or 0
        elif r.status == "lost":
            by_user[uid]["lost"] += 1
        else:
            by_user[uid]["pending"] += 1
    result = []
    for uid, d in sorted(by_user.items(), key=lambda x: x[1]["successful"], reverse=True):
        sc = d["sc"]
        su = d["successful"]
        result.append(
            UserLeadPerformance(
                user_id=uid,
                user_name=umap.get(uid, ""),
                total_leads=d["total"],
                successful=su,
                pending=d["pending"],
                lost=d["lost"],
                conversion_rate=round(su / d["total"] * 100, 2) if d["total"] else 0,
                total_service_charge=sc,
                avg_service_charge=round(sc / su, 2) if su else 0,
            )
        )
    return result


@router.get("/monthly-summary", response_model=list[MonthlySummary])
async def monthly_summary(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = user_role(user)
    is_admin = role in (UserRole.admin.value, UserRole.global_write.value)
    base = select(Lead)
    if not is_admin:
        base = base.where(Lead.assigned_to == user.id)
    if date_from:
        try:
            base = base.where(Lead.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            base = base.where(Lead.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    rows = (await db.execute(base)).scalars().all()
    by_month: dict[str, dict] = {}
    for r in rows:
        if r.created_at:
            key = r.created_at.strftime("%Y-%m")
        else:
            key = "unknown"
        if key not in by_month:
            by_month[key] = {"total": 0, "successful": 0, "lost": 0}
        by_month[key]["total"] += 1
        if r.status == "successful":
            by_month[key]["successful"] += 1
        elif r.status == "lost":
            by_month[key]["lost"] += 1
    return [
        MonthlySummary(month=k, total_leads=v["total"], successful=v["successful"], lost=v["lost"])
        for k, v in sorted(by_month.items())
    ]


@router.get("/package-demand")
async def package_demand(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    base = select(Lead)
    if date_from:
        try:
            base = base.where(Lead.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            base = base.where(Lead.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    rows = (await db.execute(base)).scalars().all()
    pkgs: dict[str, int] = {}
    for r in rows:
        name = r.package_name or "Unspecified"
        pkgs[name] = pkgs.get(name, 0) + 1
    return [{"package": k, "count": v} for k, v in sorted(pkgs.items(), key=lambda x: x[1], reverse=True)]


@router.get("/source-performance")
async def source_performance(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    base = select(Lead)
    if date_from:
        try:
            base = base.where(Lead.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            base = base.where(Lead.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    rows = (await db.execute(base)).scalars().all()
    by_src: dict[str, dict] = {}
    for r in rows:
        src = r.lead_source or "other"
        if src not in by_src:
            by_src[src] = {"total": 0, "successful": 0}
        by_src[src]["total"] += 1
        if r.status == "successful":
            by_src[src]["successful"] += 1
    return [{"source": k, "total": v["total"], "successful": v["successful"]} for k, v in sorted(by_src.items())]


@router.get("/wards/list")
async def list_wards(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(Lead.ward).where(Lead.ward != "").distinct())).scalars().all()
    return sorted(rows)


@router.get("/packages/list")
async def list_packages(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(Lead.package_name).where(Lead.package_name != "").distinct())).scalars().all()
    return sorted(rows)


@router.get("/{lead_id}", response_model=LeadOut)
async def get_lead(
    lead_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    role = user_role(user)
    is_admin = role in (UserRole.admin.value, UserRole.global_write.value)
    if not is_admin and lead.assigned_to != user.id:
        raise HTTPException(status_code=403, detail="You can only view leads assigned to you")
    umap = await _user_map(db)
    return _to_out(lead, umap)


@router.post("", response_model=LeadOut)
async def create_lead(
    body: LeadCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lead = Lead(
        customer_name=body.customer_name.strip(),
        mobile_primary=body.mobile_primary.strip(),
        mobile_secondary=body.mobile_secondary.strip(),
        road_area=body.road_area.strip(),
        ward=body.ward.strip(),
        package_name=body.package_name.strip(),
        service_charge=body.service_charge,
        lead_source=body.lead_source,
        assigned_to=body.assigned_to,
        status=body.status or "new",
        priority=body.priority or "normal",
        expected_connection_date=body.expected_connection_date,
        customer_address=body.customer_address.strip(),
        notes=body.notes.strip(),
        latitude=body.latitude,
        longitude=body.longitude,
        follow_up_date=body.follow_up_date,
        follow_up_notes=body.follow_up_notes.strip(),
        lost_reason=body.lost_reason.strip(),
        created_by=user.id,
    )
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    umap = await _user_map(db)
    return _to_out(lead, umap)


@router.put("/{lead_id}", response_model=LeadOut)
async def update_lead(
    lead_id: int,
    body: LeadUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    role = user_role(user)
    is_admin = role in (UserRole.admin.value, UserRole.global_write.value)
    if not is_admin and lead.assigned_to != user.id:
        raise HTTPException(status_code=403, detail="You can only update leads assigned to you")
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(lead, field, value)
    lead.updated_at = utcnow()
    await db.commit()
    await db.refresh(lead)
    umap = await _user_map(db)
    return _to_out(lead, umap)


@router.delete("/{lead_id}", status_code=204)
async def delete_lead(
    lead_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_write),
):
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    await db.delete(lead)
    await db.commit()


@router.post("/{lead_id}/convert", response_model=LeadOut)
async def convert_lead(
    lead_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.status == "successful" and lead.converted_to_subscriber:
        raise HTTPException(status_code=422, detail="Lead already converted")
    lead.status = "successful"
    lead.converted_at = utcnow()
    lead.updated_at = utcnow()
    await db.commit()
    await db.refresh(lead)
    umap = await _user_map(db)
    return _to_out(lead, umap)
