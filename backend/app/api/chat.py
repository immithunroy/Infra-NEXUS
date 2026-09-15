"""AI Chat API endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import ChatMessage, ChatSession, Setting, User
from ..schemas import ConfigDict
from ..security import get_current_user, require_admin
from ..services.ai_chat import FREE_MODELS, generate_response

router = APIRouter(prefix="/api/chat", tags=["chat"], dependencies=[Depends(get_current_user)])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ChatConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    provider: str
    model: str
    api_key_set: bool


class ChatConfigUpdate(BaseModel):
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    session_id: int
    role: str
    content: str
    sql_query: str | None = None
    row_count: int | None = None
    created_at: str


class SendMessageIn(BaseModel):
    content: str


class ModelsByProvider(BaseModel):
    provider: str
    models: list[dict[str, str]]


# ---------------------------------------------------------------------------
# Config endpoints (admin only)
# ---------------------------------------------------------------------------

@router.get("/config", response_model=ChatConfigOut)
async def get_chat_config(user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Setting).where(Setting.key.in_(["ai_provider", "ai_model", "ai_api_key"]))
    )
    settings = {s.key: s.value for s in result.scalars().all()}
    api_key = settings.get("ai_api_key", "")
    return ChatConfigOut(
        provider=settings.get("ai_provider", "openrouter"),
        model=settings.get("ai_model", "meta-llama/llama-3.1-8b-instruct:free"),
        api_key_set=bool(api_key),
    )


@router.put("/config", response_model=ChatConfigOut)
async def update_chat_config(
    body: ChatConfigUpdate,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if body.provider is not None:
        await _set_setting(db, "ai_provider", body.provider)
    if body.model is not None:
        await _set_setting(db, "ai_model", body.model)
    if body.api_key is not None:
        await _set_setting(db, "ai_api_key", body.api_key)
    await db.commit()
    return await get_chat_config(user=user, db=db)


@router.get("/models", response_model=list[ModelsByProvider])
async def list_models(user: User = Depends(require_admin)):
    return [
        ModelsByProvider(
            provider=p,
            models=[{"id": m[0], "label": m[1]} for m in models],
        )
        for p, models in FREE_MODELS.items()
    ]


# ---------------------------------------------------------------------------
# Session endpoints
# ---------------------------------------------------------------------------

@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChatSession, func.count(ChatMessage.id).label("msg_count"))
        .outerjoin(ChatMessage, ChatSession.id == ChatMessage.session_id)
        .where(ChatSession.user_id == user.id)
        .group_by(ChatSession.id)
        .order_by(ChatSession.updated_at.desc())
    )
    sessions = []
    for row in result:
        s = row[0]
        sessions.append(SessionOut(
            id=s.id,
            title=s.title,
            created_at=s.created_at.isoformat() if s.created_at else "",
            updated_at=s.updated_at.isoformat() if s.updated_at else "",
            message_count=row[1] or 0,
        ))
    return sessions


@router.post("/sessions", response_model=SessionOut)
async def create_session(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    session = ChatSession(user_id=user.id, title="New Chat")
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return SessionOut(
        id=session.id,
        title=session.title,
        created_at=session.created_at.isoformat() if session.created_at else "",
        updated_at=session.updated_at.isoformat() if session.updated_at else "",
        message_count=0,
    )


@router.get("/sessions/{session_id}", response_model=list[MessageOut])
async def get_messages(
    session_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_user_session(db, session_id, user.id)
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    return [
        MessageOut(
            id=m.id,
            session_id=m.session_id,
            role=m.role,
            content=m.content,
            sql_query=m.sql_query,
            row_count=m.row_count,
            created_at=m.created_at.isoformat() if m.created_at else "",
        )
        for m in result.scalars().all()
    ]


@router.post("/sessions/{session_id}/messages", response_model=MessageOut)
async def send_message(
    session_id: int,
    body: SendMessageIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_user_session(db, session_id, user.id)
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Message cannot be empty")

    # Save user message
    user_msg = ChatMessage(session_id=session_id, role="user", content=content)
    db.add(user_msg)
    await db.flush()

    # Generate AI response
    try:
        result = await generate_response(db, content, session_id)
    except Exception as e:
        result = {
            "content": f"AI error: {str(e)}",
            "sql_query": None,
            "row_count": None,
        }

    # Save assistant message
    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=result["content"],
        sql_query=result.get("sql_query"),
        row_count=result.get("row_count"),
    )
    db.add(assistant_msg)

    # Auto-title: use first user message as session title
    if session.title == "New Chat":
        session.title = content[:80]

    session.updated_at = func.now()
    await db.commit()
    await db.refresh(assistant_msg)

    return MessageOut(
        id=assistant_msg.id,
        session_id=assistant_msg.session_id,
        role=assistant_msg.role,
        content=assistant_msg.content,
        sql_query=assistant_msg.sql_query,
        row_count=assistant_msg.row_count,
        created_at=assistant_msg.created_at.isoformat() if assistant_msg.created_at else "",
    )


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_user_session(db, session_id, user.id)
    await db.delete(session)
    await db.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_user_session(db: AsyncSession, session_id: int, user_id: int) -> ChatSession:
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


async def _set_setting(db: AsyncSession, key: str, value: str):
    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        db.add(Setting(key=key, value=value))
