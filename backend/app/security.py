from __future__ import annotations

from datetime import timedelta
from typing import Callable

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .database import get_db
from .models import User, UserRole
from .utils.time import utcnow

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
settings = get_settings()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: int, username: str, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": utcnow() + timedelta(minutes=settings.jwt_expire_minutes),
        "iat": utcnow(),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = int(payload.get("sub"))
    except (jwt.PyJWTError, TypeError, ValueError):
        raise credentials_exc
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if user is None:
        raise credentials_exc
    return user


# ---------------------------------------------------------------------------
# Role-based permission model.
#
#   admin        -> everything (incl. user management)
#   global_write -> everything except user management / role changes
#   global_read  -> read-only
#   noc          -> read + network operations (scan/test/down-detection),
#                   no user management, no GPS/address edits
#   field_team   -> read + update address & GPS only
# ---------------------------------------------------------------------------

# Roles that may modify GPS / address on subscriber profiles.
_GPS_WRITE_ROLES = {UserRole.admin, UserRole.global_write, UserRole.field_team}
# Roles that may run scans / tests / live down detection.
_OPS_ROLES = {UserRole.admin, UserRole.global_write, UserRole.noc}
# Roles that may change data (write endpoints) beyond ops/GPS.
_WRITE_ROLES = {UserRole.admin, UserRole.global_write}
# Roles that may manage users and roles.
_ADMIN_ROLES = {UserRole.admin}
# Roles that may submit fiber infrastructure changes for approval.
_FIBER_REQUEST_ROLES = {UserRole.admin, UserRole.global_write, UserRole.field_team}
# Roles that may review/approve/return submissions in the NOC approval queue.
_NOC_APPROVAL_ROLES = {UserRole.admin, UserRole.global_write, UserRole.noc}
# Roles that may submit to the approval queue (Android / field submissions).
_APPROVAL_SUBMIT_ROLES = {UserRole.admin, UserRole.global_write, UserRole.field_team}


def user_role(user: User) -> str:
    return user.role.value if hasattr(user.role, "value") else str(user.role)


def _denied() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Your role does not permit this action",
    )


def require_write(user: User = Depends(get_current_user)) -> User:
    if user_role(user) not in _WRITE_ROLES:
        raise _denied()
    return user


def require_ops(user: User = Depends(get_current_user)) -> User:
    if user_role(user) not in _OPS_ROLES:
        raise _denied()
    return user


def require_gps_write(user: User = Depends(get_current_user)) -> User:
    if user_role(user) not in _GPS_WRITE_ROLES:
        raise _denied()
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user_role(user) not in _ADMIN_ROLES:
        raise _denied()
    return user


def require_fiber_request(user: User = Depends(get_current_user)) -> User:
    if user_role(user) not in _FIBER_REQUEST_ROLES:
        raise _denied()
    return user


def require_noc_approval(user: User = Depends(get_current_user)) -> User:
    if user_role(user) not in _NOC_APPROVAL_ROLES:
        raise _denied()
    return user


def require_approval_submit(user: User = Depends(get_current_user)) -> User:
    if user_role(user) not in _APPROVAL_SUBMIT_ROLES:
        raise _denied()
    return user


def role_in(*roles: UserRole) -> Callable:
    allowed = set(roles)

    def _check(user: User = Depends(get_current_user)) -> User:
        if user_role(user) not in allowed:
            raise _denied()
        return user

    return _check