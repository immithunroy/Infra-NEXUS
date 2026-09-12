"""One-time script to add lead management users."""
import asyncio
from app.database import async_session
from app.models import User, UserRole
from app.security import hash_password
from sqlalchemy import select


USERS = [
    ("sajjad", "user123", UserRole.field_team),
    ("imran", "user123", UserRole.field_team),
    ("hridoy", "user123", UserRole.field_team),
    ("amit", "user123", UserRole.field_team),
    ("pritom", "user123", UserRole.field_team),
    ("babul", "user123", UserRole.field_team),
    ("ahana", "user123", UserRole.global_write),
    ("arman", "user123", UserRole.global_write),
    ("sourav", "user123", UserRole.field_team),
]


async def main():
    async with async_session() as db:
        for username, password, role in USERS:
            exists = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
            if exists:
                print(f"  SKIP  {username} (already exists)")
                continue
            user = User(
                username=username,
                password_hash=hash_password(password),
                role=role,
                is_admin=(role == UserRole.admin),
            )
            db.add(user)
            print(f"  ADDED {username} ({role.value})")
        await db.commit()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
