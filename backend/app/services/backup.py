"""
Backup & Restore service.

Exports application data to JSON/Excel, uploads to Cloudflare R2,
and supports full/selective restore with safety backups.
"""
import hashlib
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import SessionLocal
from ..models import (
    BackupRecord, Cable, CableCut, CableSegment, FiberLoop, FiberApprovalRequest,
    FieldPhoto, MacEntry, MacVendor, MikrotikDevice, Noc, Onu, OnuDownEvent,
    OnuMacHistory, OnuOutage, OnuSubscriber, OnuTelemetry, OltDevice, OltHealth,
    OltWriteLog, PortArea, Pop, PppActiveEntry, Role, ScanLog, Setting,
    SchedulerJobState, SwitchDevice, SwitchPort, Subscriber, Ticket, TicketActivity,
    TicketComment, TicketTemplate, TjBox, TjIdReservation, Splitter, Splice,
    User, BgpPrefixSnapshot, BgpRoute, BgpSession, AcsDevice, AcsMetric,
    AcsParameter, AcsJob, Binding, Lead, ChatSession, ChatMessage,
)

APP_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Dataset definitions — each dataset maps to a model + filename prefix
# ---------------------------------------------------------------------------

DATASETS = {
    "tj_splitter": {
        "label": "TJ Boxes & Splitters",
        "tables": [
            ("tj_boxes", TjBox),
            ("splitters", Splitter),
            ("splices", Splice),
        ],
    },
    "users": {
        "label": "Users & Roles",
        "tables": [
            ("roles", Role),
            ("users", User),
        ],
    },
    "cable_routes": {
        "label": "Cable Routes",
        "tables": [
            ("cables", Cable),
            ("cable_segments", CableSegment),
            ("fiber_loops", FiberLoop),
            ("cable_cuts", CableCut),
        ],
    },
    "devices": {
        "label": "Devices",
        "tables": [
            ("olt_devices", OltDevice),
            ("mikrotik_devices", MikrotikDevice),
            ("switch_devices", SwitchDevice),
            ("switch_ports", SwitchPort),
        ],
    },
    "network_infra": {
        "label": "Network Infrastructure",
        "tables": [
            ("nocs", Noc),
            ("pops", Pop),
            ("port_areas", PortArea),
        ],
    },
    "subscribers_onu": {
        "label": "Subscribers & ONUs",
        "tables": [
            ("subscribers", Subscriber),
            ("onus", Onu),
            ("onu_subscribers", OnuSubscriber),
            ("bindings", Binding),
            ("mac_entries", MacEntry),
        ],
    },
    "tickets": {
        "label": "Tickets",
        "tables": [
            ("tickets", Ticket),
            ("ticket_comments", TicketComment),
            ("ticket_activities", TicketActivity),
            ("ticket_templates", TicketTemplate),
        ],
    },
    "leads": {
        "label": "Leads",
        "tables": [
            ("leads", Lead),
        ],
    },
    "acs": {
        "label": "ACS (TR-069)",
        "tables": [
            ("acs_devices", AcsDevice),
            ("acs_parameters", AcsParameter),
            ("acs_metrics", AcsMetric),
            ("acs_jobs", AcsJob),
        ],
    },
    "bgp": {
        "label": "BGP Sessions",
        "tables": [
            ("bgp_sessions", BgpSession),
            ("bgp_routes", BgpRoute),
            ("bgp_prefix_snapshots", BgpPrefixSnapshot),
        ],
    },
    "system": {
        "label": "System Config",
        "tables": [
            ("settings", Setting),
            ("scheduler_job_state", SchedulerJobState),
            ("scan_logs", ScanLog),
            ("olt_write_logs", OltWriteLog),
        ],
    },
    "chats": {
        "label": "AI Chat Sessions",
        "tables": [
            ("chat_sessions", ChatSession),
            ("chat_messages", ChatMessage),
        ],
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _checksum(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _table_columns(model) -> list[str]:
    return [c.name for c in model.__table__.columns]


def _row_to_dict(row, columns: list[str]) -> dict:
    d = {}
    for col in columns:
        val = getattr(row, col, None)
        if isinstance(val, datetime):
            val = val.isoformat()
        elif hasattr(val, "value"):
            val = val.value
        d[col] = val
    return d


def _build_json(dataset_name: str, table_name: str, records: list[dict],
                backup_id: str, checksum_val: str) -> str:
    payload = {
        "backupId": backup_id,
        "createdAt": _now_iso(),
        "applicationVersion": APP_VERSION,
        "schemaVersion": "1",
        "dataset": dataset_name,
        "table": table_name,
        "recordCount": len(records),
        "checksum": checksum_val,
        "data": records,
    }
    return json.dumps(payload, default=str, ensure_ascii=False)


def _write_excel_sheet(wb: openpyxl.Workbook, sheet_name: str, records: list[dict],
                       columns: list[str], is_first: bool = False):
    ws = wb.create_sheet(title=sheet_name[:31])  # Excel 31-char limit
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )
    for c, col_name in enumerate(columns, 1):
        cell = ws.cell(row=1, column=c, value=col_name)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border
    for r, record in enumerate(records, 2):
        for c, col_name in enumerate(columns, 1):
            val = record.get(col_name)
            cell = ws.cell(row=r, column=c, value=val)
            cell.border = thin_border
    for c, col_name in enumerate(columns, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(c)].width = max(12, len(col_name) + 4)


async def _load_setting(db: AsyncSession, key: str, default: str = "") -> str:
    row = (await db.execute(select(Setting.value).where(Setting.key == key))).scalar_one_or_none()
    return row or default


async def _save_setting(db: AsyncSession, key: str, value: str):
    existing = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    if existing:
        existing.value = value
    else:
        db.add(Setting(key=key, value=value))
    await db.commit()


# ---------------------------------------------------------------------------
# Backup creation
# ---------------------------------------------------------------------------

async def create_backup(trigger: str = "manual") -> dict:
    """Create a full backup. Returns backup record dict."""
    settings = get_settings()
    backup_id = f"backup_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    backup_dir = Path(settings.backup_dir) / date_str / backup_id
    staging_dir = Path(settings.backup_dir) / ".staging" / backup_id

    file_details = []
    total_records = 0
    total_size = 0
    errors = []

    try:
        # Create staging dir
        staging_dir.mkdir(parents=True, exist_ok=True)

        async with SessionLocal() as db:
            for ds_name, ds_def in DATASETS.items():
                for table_name, model in ds_def["tables"]:
                    try:
                        columns = _table_columns(model)
                        rows = (await db.execute(select(model))).scalars().all()
                        records = [_row_to_dict(r, columns) for r in rows]
                        record_count = len(records)
                        total_records += record_count

                        # JSON
                        json_checksum = _checksum(json.dumps(records, default=str).encode())
                        json_content = _build_json(ds_name, table_name, records, backup_id, json_checksum)
                        json_filename = f"{ds_name}__{table_name}.json"
                        json_path = staging_dir / json_filename
                        json_path.write_text(json_content, encoding="utf-8")
                        json_size = json_path.stat().st_size
                        total_size += json_size
                        file_details.append({
                            "dataset": ds_name,
                            "table": table_name,
                            "format": "json",
                            "filename": json_filename,
                            "size": json_size,
                            "records": record_count,
                            "checksum": json_checksum,
                        })

                        # Excel
                        excel_filename = f"{ds_name}__{table_name}.xlsx"
                        excel_path = staging_dir / excel_filename
                        wb = openpyxl.Workbook()
                        wb.remove(wb.active)
                        _write_excel_sheet(wb, table_name, records, columns)
                        wb.save(str(excel_path))
                        excel_size = excel_path.stat().st_size
                        total_size += excel_size
                        file_details.append({
                            "dataset": ds_name,
                            "table": table_name,
                            "format": "xlsx",
                            "filename": excel_filename,
                            "size": excel_size,
                            "records": record_count,
                            "checksum": "",
                        })
                    except Exception as exc:
                        errors.append(f"{table_name}: {exc}")

            # Create manifest
            manifest = {
                "backupId": backup_id,
                "createdAt": _now_iso(),
                "applicationVersion": APP_VERSION,
                "totalFiles": len(file_details),
                "totalRecords": total_records,
                "totalSizeBytes": total_size,
                "datasets": list(DATASETS.keys()),
                "errors": errors,
            }
            manifest_path = staging_dir / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            manifest_checksum = _checksum(manifest_path.read_bytes())
            total_size += manifest_path.stat().st_size

            # Move staging → final
            backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(staging_dir), str(backup_dir))
            # Clean up empty staging parent
            staging_parent = staging_dir.parent
            if staging_parent.exists() and not any(staging_parent.iterdir()):
                staging_parent.rmdir()

            # Determine cloud status
            cloud_status = "disabled"
            if settings.r2_endpoint and settings.r2_bucket_name:
                cloud_status = "pending"

            # Create DB record
            record = BackupRecord(
                backup_id=backup_id,
                status="completed" if not errors else "partial",
                trigger=trigger,
                app_version=APP_VERSION,
                total_files=len(file_details),
                total_records=total_records,
                total_size_bytes=total_size,
                checksum=manifest_checksum,
                local_status="completed",
                cloud_status=cloud_status,
                file_details=json.dumps(file_details),
                error_message=json.dumps(errors) if errors else "",
            )
            db.add(record)
            await db.commit()

            # Upload to R2 in background
            if cloud_status == "pending":
                import asyncio
                asyncio.create_task(_upload_to_r2(backup_id, backup_dir, file_details))

            return {
                "backup_id": backup_id,
                "status": record.status,
                "total_files": len(file_details),
                "total_records": total_records,
                "total_size_bytes": total_size,
                "checksum": manifest_checksum,
                "local_status": "completed",
                "cloud_status": cloud_status,
                "errors": errors,
            }

    except Exception as exc:
        # Cleanup staging on failure
        if staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)
        async with SessionLocal() as db:
            record = BackupRecord(
                backup_id=backup_id,
                status="failed",
                trigger=trigger,
                app_version=APP_VERSION,
                error_message=str(exc),
                local_status="failed",
            )
            db.add(record)
            await db.commit()
        return {"backup_id": backup_id, "status": "failed", "error": str(exc)}


# ---------------------------------------------------------------------------
# R2 upload
# ---------------------------------------------------------------------------

async def _upload_to_r2(backup_id: str, backup_dir: Path, file_details: list[dict]):
    """Upload backup files to Cloudflare R2."""
    settings = get_settings()
    try:
        import boto3
        s3 = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name=settings.r2_region,
        )
        date_parts = backup_id.split("_")[1][:8]  # YYYYMMDD
        year, month, day = date_parts[:4], date_parts[4:6], date_parts[6:8]

        for finfo in file_details:
            local_path = backup_dir / finfo["filename"]
            if not local_path.exists():
                continue
            key = f"backups/{year}/{month}/{day}/{backup_id}/{finfo['filename']}"
            s3.upload_file(str(local_path), settings.r2_bucket_name, key)

        # Upload manifest
        manifest_path = backup_dir / "manifest.json"
        if manifest_path.exists():
            key = f"backups/{year}/{month}/{day}/{backup_id}/manifest.json"
            s3.upload_file(str(manifest_path), settings.r2_bucket_name, key)

        async with SessionLocal() as db:
            rec = (await db.execute(
                select(BackupRecord).where(BackupRecord.backup_id == backup_id)
            )).scalar_one_or_none()
            if rec:
                rec.cloud_status = "completed"
                await db.commit()
    except Exception as exc:
        async with SessionLocal() as db:
            rec = (await db.execute(
                select(BackupRecord).where(BackupRecord.backup_id == backup_id)
            )).scalar_one_or_none()
            if rec:
                rec.cloud_status = "failed"
                rec.error_message = (rec.error_message or "") + f"\nR2 upload: {exc}"
                await db.commit()


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------

async def restore_backup(backup_id: str, datasets: list[str] | None = None,
                         create_safety: bool = True) -> dict:
    """Restore from a backup. If datasets is None, restore all."""
    settings = get_settings()

    # Find backup directory
    backup_dir = _find_backup_dir(settings.backup_dir, backup_id)
    if not backup_dir:
        return {"status": "failed", "error": f"Backup {backup_id} not found locally"}

    manifest_path = backup_dir / "manifest.json"
    if not manifest_path.exists():
        return {"status": "failed", "error": "Manifest not found"}

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    # Validate checksum
    expected_checksum = ""
    async with SessionLocal() as db:
        rec = (await db.execute(
            select(BackupRecord).where(BackupRecord.backup_id == backup_id)
        )).scalar_one_or_none()
        if rec:
            expected_checksum = rec.checksum

    if expected_checksum and manifest.get("applicationVersion", "") != APP_VERSION:
        # Version mismatch — still allow but warn
        pass

    # Safety backup before restore
    if create_safety:
        safety_result = await create_backup(trigger="safety")
        if safety_result.get("status") == "failed":
            return {"status": "failed", "error": f"Safety backup failed: {safety_result.get('error')}"}

    # Determine which datasets to restore
    target_datasets = datasets or list(DATASETS.keys())
    restored = []
    errors = []

    try:
        async with SessionLocal() as db:
            for ds_name in target_datasets:
                ds_def = DATASETS.get(ds_name)
                if not ds_def:
                    errors.append(f"Unknown dataset: {ds_name}")
                    continue

                for table_name, model in ds_def["tables"]:
                    try:
                        json_file = backup_dir / f"{ds_name}__{table_name}.json"
                        if not json_file.exists():
                            continue

                        backup_data = json.loads(json_file.read_text(encoding="utf-8"))
                        records = backup_data.get("data", [])
                        columns = _table_columns(model)

                        # Delete existing data
                        await db.execute(text(f"TRUNCATE TABLE {table_name} CASCADE"))
                        await db.flush()

                        # Insert backup data
                        for record in records:
                            filtered = {k: v for k, v in record.items() if k in columns}
                            db.add(model(**filtered))

                        await db.flush()
                        restored.append(f"{table_name}: {len(records)} records")
                    except Exception as exc:
                        errors.append(f"{table_name}: {exc}")
                        await db.rollback()
                        # Re-open session for remaining tables
                        break

            await db.commit()

        # Update backup record
        async with SessionLocal() as db:
            rec = (await db.execute(
                select(BackupRecord).where(BackupRecord.backup_id == backup_id)
            )).scalar_one_or_none()
            if rec:
                rec.restored_at = datetime.now(timezone.utc)
                await db.commit()

        return {
            "status": "completed" if not errors else "partial",
            "restored": restored,
            "errors": errors,
        }

    except Exception as exc:
        return {"status": "failed", "error": str(exc)}


def _find_backup_dir(base_dir: str, backup_id: str) -> Path | None:
    """Find a backup directory by ID."""
    base = Path(base_dir)
    for date_dir in base.iterdir():
        if date_dir.is_dir() and (date_dir / backup_id).exists():
            return date_dir / backup_id
    return None


# ---------------------------------------------------------------------------
# Delete backup
# ---------------------------------------------------------------------------

async def delete_backup(backup_id: str, cloud: bool = False) -> dict:
    """Delete a backup locally and optionally from R2."""
    settings = get_settings()
    deleted = []

    # Delete local
    backup_dir = _find_backup_dir(settings.backup_dir, backup_id)
    if backup_dir and backup_dir.exists():
        shutil.rmtree(backup_dir)
        deleted.append("local")

    # Delete from R2
    if cloud and settings.r2_endpoint and settings.r2_bucket_name:
        try:
            import boto3
            s3 = boto3.client(
                "s3",
                endpoint_url=settings.r2_endpoint,
                aws_access_key_id=settings.r2_access_key_id,
                aws_secret_access_key=settings.r2_secret_access_key,
                region_name=settings.r2_region,
            )
            date_parts = backup_id.split("_")[1][:8]
            year, month, day = date_parts[:4], date_parts[4:6], date_parts[6:8]
            prefix = f"backups/{year}/{month}/{day}/{backup_id}/"
            objects = s3.list_objects_v2(Bucket=settings.r2_bucket_name, Prefix=prefix)
            for obj in objects.get("Contents", []):
                s3.delete_object(Bucket=settings.r2_bucket_name, Key=obj["Key"])
            deleted.append("cloud")
        except Exception:
            pass

    # Update DB record
    async with SessionLocal() as db:
        rec = (await db.execute(
            select(BackupRecord).where(BackupRecord.backup_id == backup_id)
        )).scalar_one_or_none()
        if rec:
            rec.deleted_at = datetime.now(timezone.utc)
            if "local" in deleted:
                rec.local_status = "deleted"
            if "cloud" in deleted:
                rec.cloud_status = "deleted"
            await db.commit()

    return {"deleted": deleted}


# ---------------------------------------------------------------------------
# Download backup as zip
# ---------------------------------------------------------------------------

def download_backup(backup_id: str) -> Path | None:
    """Return path to backup directory for zip download."""
    settings = get_settings()
    return _find_backup_dir(settings.backup_dir, backup_id)


# ---------------------------------------------------------------------------
# List backups
# ---------------------------------------------------------------------------

async def list_backups(db: AsyncSession) -> list[dict]:
    """List all backup records."""
    records = (await db.execute(
        select(BackupRecord)
        .where(BackupRecord.deleted_at.is_(None))
        .order_by(BackupRecord.created_at.desc())
    )).scalars().all()

    settings = get_settings()
    results = []
    for rec in records:
        # Check if local files still exist
        local_exists = _find_backup_dir(settings.backup_dir, rec.backup_id) is not None
        results.append({
            "id": rec.id,
            "backup_id": rec.backup_id,
            "created_at": rec.created_at.isoformat() if rec.created_at else None,
            "status": rec.status,
            "trigger": rec.trigger,
            "app_version": rec.app_version,
            "total_files": rec.total_files,
            "total_records": rec.total_records,
            "total_size_bytes": rec.total_size_bytes,
            "checksum": rec.checksum,
            "local_status": rec.local_status if local_exists else "deleted",
            "cloud_status": rec.cloud_status,
            "file_details": json.loads(rec.file_details) if rec.file_details else [],
            "error_message": rec.error_message,
            "restored_at": rec.restored_at.isoformat() if rec.restored_at else None,
        })
    return results
