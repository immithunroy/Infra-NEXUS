from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User, UserRole
from ..schemas import UserCreate, UserOut, UserUpdate
from ..security import get_current_user, hash_password, require_admin, user_role

router = APIRouter(
    prefix="/api/users",
    tags=["users"],
    dependencies=[Depends(get_current_user)],
)


def _role(value: str | None) -> UserRole:
    if not value:
        return UserRole.global_read
    try:
        return UserRole(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown role: {value}")


@router.get("", response_model=list[UserOut])
async def list_users(user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(User).order_by(User.id))).scalars().all()
    return rows


@router.post("", response_model=UserOut)
async def create_user(body: UserCreate, user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    role = _role(body.role)
    exists = (
        await db.execute(select(User).where(User.username == body.username))
    ).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Username already exists")
    if len(body.password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters")
    new_user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=role,
        is_admin=(role == UserRole.admin),
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user


@router.put("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if body.username is not None:
        dup = (
            await db.execute(select(User).where(User.username == body.username, User.id != user_id))
        ).scalar_one_or_none()
        if dup is not None:
            raise HTTPException(status_code=409, detail="Username already exists")
        target.username = body.username
    if body.role is not None:
        role = _role(body.role)
        target.role = role
        target.is_admin = role == UserRole.admin
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(status_code=422, detail="Password must be at least 6 characters")
        target.password_hash = hash_password(body.password)
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: int, user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if user_id == user.id:
        raise HTTPException(status_code=422, detail="You cannot delete your own account")
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(target)
    await db.commit()
