"""
AI Chat service — multi-provider LLM integration with database access.

Supported providers: OpenRouter, Groq, Google AI Studio, OpenAI.
All use OpenAI-compatible chat completions API except Google.
"""

import json
import logging
import re
from datetime import datetime, timezone

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ChatMessage, ChatSession, Setting

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DB schema reference — injected into the system prompt so the LLM knows
# what tables/columns exist and can write correct SQL.
# ---------------------------------------------------------------------------
DB_SCHEMA = """
## Database Schema (PostgreSQL — read-only access)

### Network Devices
- olt_devices: id, name, ip, vendor, pon_type (gpon/epon), status (reachable/unreachable), port_capacity, last_scan_at, noc_id, pop_id
- mikrotik_devices: id, name, ip, status, subscriber_count, active_count, last_scan_at
- switch_devices: id, name, ip, vendor, port_count, status, last_scan_at
- switch_ports: id, switch_id FK, name, status, speed, vlan, mac_address, rx_bytes, tx_bytes

### ONUs (Optical Network Units)
- onus: id, olt_id FK, source (manual/auto), state (active/inactive/offline), name, serial, mac, pon_port, onu_id, vlan, rx_power, tx_power, distance, last_mac, subscriber (PPPoE username), bound (bool), down_reason, bandwidth_mode (100m/1g), address, gps_lat, gps_lng, phone, email, last_seen, created_at
- onu_down_events: id, olt_id FK, pon_port, onu_id, serial, name, kind (down/recovery/outage), reason, detected_at, duration_seconds
- onu_telemetry: id, onu_id FK, olt_id FK, pon_port, rx_power, tx_power, in_octets, out_octets, sampled_at
- onu_outages: id, olt_id FK, olt_name, pon_port, started_at, onu_count, resolved_at, resolved

### Subscribers & Bindings
- subscribers: id, pppoe_username (unique), mikrotik_device_id FK, disabled, service, profile, last_seen_at
- bindings: id, mac, olt_id FK, olt_port, mikrotik_id FK, subscriber, onu_id FK, bound
- mac_entries: id, olt_id FK, mac, port, vlan, first_seen, last_seen

### Fiber Infrastructure
- cables: id, link_id (unique, e.g. LINK-0001), link_name, code (drum code), core_count, cable_type, src_tj_id FK, dst_tj_id FK
- tj_boxes: id, unique_id, name, box_type (home_tj/regular_tj/enclosure/dome), lat, lng, address, noc_id FK, pop_id FK
- splitters: id, unique_id, name, split_ratio, tj_box_id FK, lat, lng
- splices: id, tj_id FK, cable_a_id FK, core_a, cable_b_id FK, core_b, status (active/spare/broken)
- cable_cuts: id, cable_id FK, lat, lng, cut_date, repair_date, status (cut/repaired)

### Tickets
- tickets: id, ticket_ref (e.g. TT-260912001), title, description, status (open/in_progress/resolved/closed), priority (low/normal/high/urgent), category, department, assigned_to FK, created_by FK, subscriber, onu_id FK, phone1, phone2, created_at, updated_at, resolved_at
- ticket_comments: id, ticket_id FK, user_id FK, body, comment_type (general/employee/closing/suggestion), created_at

### ACS / TR-069
- acs_devices: id, serial_number, manufacturer, model_name, subscriber, online, last_inform, last_cpu, last_mem_used, last_rx_rate, last_tx_rate

### Leads (Sales)
- leads: id, customer_name, mobile_primary, status (new/contacted/converted/lost), assigned_to FK, package_name, service_charge, otc, created_at

### Organization
- pops: id, name, address
- nocs: id, name, address
- users: id, username, full_name, role, is_active

### Settings
- settings: key (PK), value — stores google_maps_api_key, ai_provider, ai_model, ai_api_key, timezone, etc.

### Key Relationships
- onus.olt_id → olt_devices.id
- onus.subscriber = subscribers.pppoe_username (logical join)
- tickets.onu_id → onus.id
- tickets.subscriber = subscribers.pppoe_username
- cables.src_tj_id / dst_tj_id → tj_boxes.id
- splices.tj_id → tj_boxes.id
- splices.cable_a_id / cable_b_id → cables.id
"""

PROVIDER_BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "openai": "https://api.openai.com/v1/chat/completions",
    "google": None,  # handled separately
}

FREE_MODELS = {
    "openrouter": [
        ("openrouter/free", "Free Auto-Router (Recommended)"),
        ("nvidia/nemotron-3-ultra-550b-a55b:free", "Nemotron 3 Ultra 550B (Free)"),
        ("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super 120B (Free)"),
        ("google/gemma-4-31b-it:free", "Gemma 4 31B (Free)"),
        ("cohere/north-mini-code:free", "North Mini Code (Free)"),
        ("nvidia/nemotron-3-nano-30b-a3b:free", "Nemotron 3 Nano 30B (Free)"),
        ("poolside/laguna-s-2.1:free", "Laguna S 2.1 (Free)"),
        ("poolside/laguna-xs-2.1:free", "Laguna XS 2.1 (Free)"),
    ],
    "groq": [
        ("llama-3.1-8b-instant", "Llama 3.1 8B Instant"),
        ("llama-3.3-70b-versatile", "Llama 3.3 70B"),
        ("mixtral-8x7b-32768", "Mixtral 8x7B"),
        ("gemma2-9b-it", "Gemma 2 9B"),
    ],
    "openai": [
        ("gpt-4o-mini", "GPT-4o Mini"),
        ("gpt-4o", "GPT-4o"),
    ],
    "google": [
        ("gemini-2.0-flash", "Gemini 2.0 Flash"),
        ("gemini-2.0-flash-lite", "Gemini 2.0 Flash Lite"),
        ("gemini-1.5-flash", "Gemini 1.5 Flash"),
    ],
}

# System prompt for the AI
SYSTEM_PROMPT = """You are Infra NEXUS AI assistant for a broadband ISP operations platform.

Your job is to answer natural-language questions about the network infrastructure by writing SQL queries and interpreting results.

RULES:
1. When the user asks about data, write a PostgreSQL SELECT query.
2. NEVER write INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, or any write operation. Only SELECT is allowed.
3. Always use LIMIT 50 unless the user explicitly asks for more rows.
4. Use proper JOINs when querying across tables.
5. Format numbers with commas for readability.
6. When showing GPS coordinates, provide them as: lat, lng
7. When the user asks a general question (not data-related), answer normally without SQL.
8. If the question is ambiguous, ask for clarification.
9. After executing SQL, explain the results in plain language.
10. For time-based queries, use the created_at or last_seen columns.

TOOL USAGE:
- You have access to an `execute_sql` tool that runs read-only SELECT queries.
- Call it when you need to fetch data from the database.
- The tool returns results as a JSON array of objects.
- If the query returns 0 rows, tell the user "No results found."

EXAMPLES:
- "How many ONUs are online?" → SELECT COUNT(*) FROM onus WHERE state = 'active';
- "Show me open tickets" → SELECT ticket_ref, title, priority, status FROM tickets WHERE status = 'open' ORDER BY created_at DESC;
- "What's the fiber cable count?" → SELECT COUNT(*) as total_cables, SUM(core_count) as total_cores FROM cables;
- "Who is the assigned technician for ticket TT-260912001?" → SELECT t.ticket_ref, u.full_name FROM tickets t JOIN users u ON t.assigned_to = u.id WHERE t.ticket_ref = 'TT-260912001';
"""


def _build_tools():
    """Define the execute_sql tool for function calling."""
    return [
        {
            "type": "function",
            "function": {
                "name": "execute_sql",
                "description": "Execute a read-only SQL SELECT query against the Infra NEXUS database. Returns rows as JSON.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "A PostgreSQL SELECT query. Only SELECT statements are allowed. Use LIMIT 50 by default.",
                        }
                    },
                    "required": ["query"],
                },
            },
        }
    ]


def _is_select_only(sql: str) -> bool:
    """Safety check — ensure the SQL is a SELECT statement only."""
    normalized = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)  # strip line comments
    normalized = re.sub(r"/\*.*?\*/", "", normalized, flags=re.DOTALL)  # strip block comments
    normalized = normalized.strip().lower()
    # Must start with SELECT or WITH (CTE)
    if not (normalized.startswith("select") or normalized.startswith("with")):
        return False
    # Reject dangerous keywords
    forbidden = ["insert", "update", "delete", "drop", "alter", "create", "truncate", "grant", "revoke"]
    for kw in forbidden:
        # Check for keyword as a whole word
        if re.search(rf"\b{kw}\b", normalized):
            return False
    return True


async def _get_provider_config(db: AsyncSession) -> dict:
    """Load AI provider config from settings table."""
    result = await db.execute(
        select(Setting).where(Setting.key.in_(["ai_provider", "ai_model", "ai_api_key"]))
    )
    settings = {s.key: s.value for s in result.scalars().all()}
    return {
        "provider": settings.get("ai_provider", "openrouter"),
        "model": settings.get("ai_model", "openrouter/free"),
        "api_key": settings.get("ai_api_key", ""),
    }


async def _execute_sql(db: AsyncSession, query: str) -> list[dict]:
    """Execute a read-only SQL query and return results as list of dicts."""
    if not _is_select_only(query):
        raise ValueError("Only SELECT queries are allowed")
    result = await db.execute(text(query))
    rows = result.mappings().all()
    return [dict(row) for row in rows]


async def _call_openai_compatible(base_url: str, api_key: str, model: str, messages: list, tools: list | None = None) -> dict:
    """Call an OpenAI-compatible API (OpenRouter, Groq, OpenAI)."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body: dict = {
        "model": model,
        "messages": messages,
        "max_tokens": 2048,
        "temperature": 0.3,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(base_url, headers=headers, json=body)
        resp.raise_for_status()
        return resp.json()


async def _call_google(api_key: str, model: str, messages: list) -> dict:
    """Call Google AI Studio (Gemini) API."""
    # Convert messages to Gemini format
    contents = []
    system_instruction = None
    for msg in messages:
        if msg["role"] == "system":
            system_instruction = {"parts": [{"text": msg["content"]}]}
        else:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body: dict = {
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": 2048,
            "temperature": 0.3,
        },
    }
    if system_instruction:
        body["systemInstruction"] = system_instruction

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=body)
        resp.raise_for_status()
        data = resp.json()

    # Extract text from Gemini response
    text_content = data["candidates"][0]["content"]["parts"][0]["text"]
    return {
        "choices": [{"message": {"role": "assistant", "content": text_content}}]
    }


async def generate_response(db: AsyncSession, user_message: str, session_id: int) -> dict:
    """
    Generate an AI response to a user message.

    Returns: {"content": str, "sql_query": str | None, "row_count": int | None}
    """
    config = await _get_provider_config(db)
    provider = config["provider"]
    model = config["model"]
    api_key = config["api_key"]

    if not api_key:
        return {
            "content": "AI provider is not configured. Please ask an administrator to set the API key in Settings.",
            "sql_query": None,
            "row_count": None,
        }

    # Build message history
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    )
    history = list(reversed(history_result.scalars().all()))

    messages = [{"role": "system", "content": SYSTEM_PROMPT + "\n\n" + DB_SCHEMA}]
    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": user_message})

    sql_query = None
    row_count = None
    final_content = ""

    # For non-Google providers, use tool calling
    if provider != "google":
        tools = _build_tools()
        max_iterations = 5  # prevent infinite loops

        for _ in range(max_iterations):
            data = await _call_openai_compatible(
                PROVIDER_BASE_URLS[provider], api_key, model, messages, tools
            )
            choice = data["choices"][0]
            msg = choice["message"]

            # If no tool calls, we're done
            if not msg.get("tool_calls"):
                final_content = msg.get("content", "")
                break

            # Append assistant message with tool calls
            messages.append(msg)

            # Process each tool call
            for tc in msg["tool_calls"]:
                func_name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"]["arguments"])
                except json.JSONDecodeError:
                    args = {}

                if func_name == "execute_sql":
                    query = args.get("query", "")
                    sql_query = query
                    try:
                        results = await _execute_sql(db, query)
                        row_count = len(results)
                        tool_result = json.dumps(results, default=str, ensure_ascii=False)
                        # Truncate if too large
                        if len(tool_result) > 8000:
                            tool_result = tool_result[:8000] + '... (truncated)'
                    except Exception as e:
                        tool_result = json.dumps({"error": str(e)})
                        row_count = 0

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": tool_result,
                    })
    else:
        # Google doesn't support tool calling the same way — just send the message
        data = await _call_google(api_key, model, messages)
        final_content = data["choices"][0]["message"]["content"]

    # If we exited the loop without setting final_content
    if not final_content:
        final_content = "I was unable to generate a response. Please try again."

    return {
        "content": final_content,
        "sql_query": sql_query,
        "row_count": row_count,
    }
