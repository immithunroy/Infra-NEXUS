from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Role
from ..security import get_current_user, require_admin

router = APIRouter(
    prefix="/api/roles",
    tags=["roles"],
    dependencies=[Depends(get_current_user)],
)

# ── All available permission keys ─────────────────────────────────────────

PERMISSION_GROUPS: dict[str, list[dict[str, str]]] = {
    "Users": [
        {"key": "users.view", "label": "View users"},
        {"key": "users.create", "label": "Create users"},
        {"key": "users.edit", "label": "Edit users"},
        {"key": "users.delete", "label": "Delete users"},
    ],
    "Devices (OLT/Router/Switch)": [
        {"key": "devices.view", "label": "View devices"},
        {"key": "devices.edit", "label": "Edit devices"},
        {"key": "devices.delete", "label": "Delete devices"},
        {"key": "scan.execute", "label": "Run OLT scan"},
        {"key": "test.execute", "label": "Run diagnostics"},
    ],
    "ONU / Subscribers": [
        {"key": "onus.view", "label": "View ONUs"},
        {"key": "onus.edit", "label": "Edit ONUs"},
        {"key": "subscribers.view", "label": "View subscribers"},
        {"key": "subscribers.edit", "label": "Edit subscribers"},
    ],
    "Fiber Infrastructure": [
        {"key": "fiber.view", "label": "View fiber map & cables"},
        {"key": "fiber.edit", "label": "Edit fiber map & cables"},
        {"key": "fiber.approve", "label": "Approve fiber changes"},
    ],
    "Tickets": [
        {"key": "tickets.view", "label": "View tickets"},
        {"key": "tickets.create", "label": "Create tickets"},
        {"key": "tickets.edit", "label": "Edit tickets"},
        {"key": "tickets.close", "label": "Close tickets"},
    ],
    "Maps": [
        {"key": "map.view", "label": "View maps"},
        {"key": "map.edit", "label": "Edit map data"},
    ],
    "Down Detection": [
        {"key": "down.view", "label": "View down status"},
        {"key": "down.execute", "label": "Run down detection"},
    ],
    "Reports & Settings": [
        {"key": "reports.view", "label": "View reports"},
        {"key": "settings.view", "label": "View settings"},
        {"key": "settings.edit", "label": "Edit settings"},
    ],
}


# ── Schemas ───────────────────────────────────────────────────────────────

class RoleOut(BaseModel):
    id: int
    name: str
    label: str
    description: str
    permissions: list[str]
    is_system: bool
    is_active: bool


class RoleCreate(BaseModel):
    name: str
    label: str = ""
    description: str = ""
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    permissions: list[str] | None = None
    is_active: bool | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("/permissions")
async def list_permissions(user=Depends(require_admin)):
    """Return all available permission keys grouped by module."""
    return PERMISSION_GROUPS


@router.get("", response_model=list[RoleOut])
async def list_roles(db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    rows = (await db.execute(select(Role).order_by(Role.id))).scalars().all()
    return [
        RoleOut(
            id=r.id,
            name=r.name,
            label=r.label,
            description=r.description,
            permissions=r.permission_list,
            is_system=r.is_system,
            is_active=r.is_active,
        )
        for r in rows
    ]


@router.post("", response_model=RoleOut)
async def create_role(body: RoleCreate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    exists = (await db.execute(select(Role).where(Role.name == body.name))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Role name already exists")
    role = Role(
        name=body.name,
        label=body.label or body.name,
        description=body.description,
        permissions=json.dumps(body.permissions),
        is_system=False,
        is_active=True,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return RoleOut(
        id=role.id, name=role.name, label=role.label, description=role.description,
        permissions=role.permission_list, is_system=role.is_system, is_active=role.is_active,
    )


@router.put("/{role_id}", response_model=RoleOut)
async def update_role(role_id: int, body: RoleUpdate, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    role = await db.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    if body.label is not None:
        role.label = body.label
    if body.description is not None:
        role.description = body.description
    if body.permissions is not None:
        role.permissions = json.dumps(body.permissions)
    if body.is_active is not None:
        role.is_active = body.is_active
    await db.commit()
    await db.refresh(role)
    return RoleOut(
        id=role.id, name=role.name, label=role.label, description=role.description,
        permissions=role.permission_list, is_system=role.is_system, is_active=role.is_active,
    )


@router.delete("/{role_id}", status_code=204)
async def delete_role(role_id: int, db: AsyncSession = Depends(get_db), user=Depends(require_admin)):
    role = await db.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=422, detail="Cannot delete built-in role")
    await db.delete(role)
    await db.commit()
