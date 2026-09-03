from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from ..schemas import ChangePasswordRequest, LoginRequest, TokenResponse, UserOut
from ..security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.username == body.username))
    user = res.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    token = create_access_token(user.id, user.username, role)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


class ChangePasswordResponse(BaseModel):
    message: str


@router.post("/change-password", response_model=ChangePasswordResponse)
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Allow authenticated user to change their own password."""
    # Verify current password
    if not verify_password(body.currentPassword, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Validate new password length
    if len(body.newPassword) < 6:
        raise HTTPException(status_code=422, detail="New password must be at least 6 characters")

    # Confirm new password matches
    if body.newPassword != body.confirmPassword:
        raise HTTPException(status_code=422, detail="New passwords do not match")

    # Reject same password
    if body.currentPassword == body.newPassword:
        raise HTTPException(status_code=422, detail="New password must be different from current password")

    # Update password
    user.password_hash = hash_password(body.newPassword)
    await db.commit()

    return ChangePasswordResponse(message="Password changed successfully")