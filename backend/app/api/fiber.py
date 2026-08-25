from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import io
import asyncio
import requests as http_requests

from ..database import get_db
from ..models import Cable, CableSegment, TjBox, Splitter, FiberLoop, CableCut, Splice, User
from ..schemas import (
    CableCreate, CableOut, CableUpdate,
    TjBoxCreate, TjBoxOut, TjBoxUpdate,
    SplitterCreate, SplitterOut, SplitterUpdate,
    FiberLoopCreate, FiberLoopOut, FiberLoopUpdate,
    CableCutCreate, CableCutOut, CableCutUpdate,
    SpliceCreate, SpliceOut, SpliceUpdate,
)
from ..security import get_current_user, require_write

router = APIRouter(prefix="/api/fiber", tags=["fiber"], dependencies=[Depends(get_current_user)])


# ------------------------------------------------------------------ Cables
@router.get("/cables", response_model=list[CableOut])
async def list_cables(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Cable).order_by(Cable.id))
    cables = res.scalars().all()
    result = []
    for c in cables:
        seg_res = await db.execute(select(CableSegment).where(CableSegment.cable_id == c.id).order_by(CableSegment.order_index))
        c.segments = seg_res.scalars().all()
        c.src_tj_name = ""
        c.dst_tj_name = ""
        if c.src_tj_id:
            tj = await db.get(TjBox, c.src_tj_id)
            if tj: c.src_tj_name = tj.name
        if c.dst_tj_id:
            tj = await db.get(TjBox, c.dst_tj_id)
            if tj: c.dst_tj_name = tj.name
        result.append(c)
    return result


@router.post("/cables", response_model=CableOut)
async def create_cable(body: CableCreate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    # Auto-generate link_id
    max_res = await db.execute(select(Cable.id).order_by(Cable.id.desc()).limit(1))
    max_id = max_res.scalar() or 0
    link_id = f"LINK-{max_id + 1001}"

    cable = Cable(
        link_id=link_id, link_name=body.link_name, code=body.code,
        core_count=body.core_count, manufacturer=body.manufacturer,
        manufacturing_year=body.manufacturing_year, cable_type=body.cable_type,
        route_type=body.route_type, src_tj_id=body.src_tj_id, dst_tj_id=body.dst_tj_id,
        notes=body.notes,
    )
    db.add(cable)
    await db.flush()

    segments = list(body.segments)
    if not segments and cable.src_tj_id and cable.dst_tj_id:
        src_tj = await db.get(TjBox, cable.src_tj_id)
        dst_tj = await db.get(TjBox, cable.dst_tj_id)
        if src_tj and dst_tj:
            profile = cable.route_type or "driving"
            coords = f"{src_tj.lng},{src_tj.lat};{dst_tj.lng},{dst_tj.lat}"
            url = f"https://router.project-osrm.org/route/v1/{profile}/{coords}?overview=full&geometries=geojson"
            try:
                def _fetch():
                    return http_requests.get(url, timeout=10)
                resp = await asyncio.to_thread(_fetch)
                data = resp.json()
                if data.get("code") == "Ok" and data["routes"]:
                    coords_list = data["routes"][0]["geometry"]["coordinates"]
                    for i in range(len(coords_list) - 1):
                        db.add(CableSegment(
                            cable_id=cable.id,
                            start_lat=coords_list[i][1], start_lng=coords_list[i][0],
                            end_lat=coords_list[i+1][1], end_lng=coords_list[i+1][0],
                            order_index=i,
                        ))
            except Exception:
                pass

    await db.commit()
    await db.refresh(cable)
    seg_res = await db.execute(select(CableSegment).where(CableSegment.cable_id == cable.id).order_by(CableSegment.order_index))
    cable.segments = seg_res.scalars().all()
    return cable


@router.put("/cables/{cable_id}", response_model=CableOut)
async def update_cable(cable_id: int, body: CableUpdate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    cable = await db.get(Cable, cable_id)
    if cable is None:
        raise HTTPException(status_code=404, detail="Cable not found")
    for field, value in body.model_dump(exclude_unset=True, exclude={"segments"}).items():
        setattr(cable, field, value)
    if body.segments is not None:
        from sqlalchemy import delete
        await db.execute(delete(CableSegment).where(CableSegment.cable_id == cable_id))
        for i, seg in enumerate(body.segments):
            db.add(CableSegment(
                cable_id=cable_id, start_lat=seg.start_lat, start_lng=seg.start_lng,
                end_lat=seg.end_lat, end_lng=seg.end_lng, order_index=i,
            ))
    await db.commit()
    await db.refresh(cable)
    seg_res = await db.execute(select(CableSegment).where(CableSegment.cable_id == cable.id).order_by(CableSegment.order_index))
    cable.segments = seg_res.scalars().all()
    return cable


@router.delete("/cables/{cable_id}", status_code=204)
async def delete_cable(cable_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    cable = await db.get(Cable, cable_id)
    if cable is None:
        raise HTTPException(status_code=404, detail="Cable not found")
    await db.delete(cable)
    await db.commit()


# ------------------------------------------------------------------ TJ Boxes
@router.get("/tj-boxes", response_model=list[TjBoxOut])
async def list_tj_boxes(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(TjBox).order_by(TjBox.id))
    return res.scalars().all()


@router.post("/tj-boxes", response_model=TjBoxOut)
async def create_tj_box(body: TjBoxCreate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(TjBox.unique_id).where(TjBox.unique_id.like("TJ-%")).order_by(TjBox.id.desc()).limit(1))
    last = res.scalar()
    next_num = 5001
    if last:
        try:
            next_num = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            pass
    box = TjBox(unique_id=f"TJ-{next_num}", **body.model_dump())
    db.add(box)
    await db.commit()
    await db.refresh(box)
    return box


@router.put("/tj-boxes/{box_id}", response_model=TjBoxOut)
async def update_tj_box(box_id: int, body: TjBoxUpdate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    box = await db.get(TjBox, box_id)
    if box is None:
        raise HTTPException(status_code=404, detail="TJ Box not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(box, field, value)
    await db.commit()
    await db.refresh(box)
    return box


@router.delete("/tj-boxes/{box_id}", status_code=204)
async def delete_tj_box(box_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    box = await db.get(TjBox, box_id)
    if box is None:
        raise HTTPException(status_code=404, detail="TJ Box not found")
    # Delete hosted splitters first
    splitters = (await db.execute(select(Splitter).where(Splitter.tj_box_id == box_id))).scalars().all()
    for sp in splitters:
        await db.delete(sp)
    await db.delete(box)
    await db.commit()


# ------------------------------------------------------------------ Splitters
@router.get("/splitters", response_model=list[SplitterOut])
async def list_splitters(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Splitter).order_by(Splitter.id))
    splitters = res.scalars().all()
    result = []
    for s in splitters:
        if s.tj_box_id:
            box = await db.get(TjBox, s.tj_box_id)
            s.tj_box_name = box.name if box else ""
        result.append(s)
    return result


@router.post("/splitters", response_model=SplitterOut)
async def create_splitter(body: SplitterCreate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Splitter.unique_id).where(Splitter.unique_id.like("SP-%")).order_by(Splitter.id.desc()).limit(1))
    last = res.scalar()
    next_num = 1001
    if last:
        try:
            next_num = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            pass
    splitter = Splitter(unique_id=f"SP-{next_num}", **body.model_dump())
    db.add(splitter)
    await db.commit()
    await db.refresh(splitter)
    return splitter


@router.put("/splitters/{splitter_id}", response_model=SplitterOut)
async def update_splitter(splitter_id: int, body: SplitterUpdate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    splitter = await db.get(Splitter, splitter_id)
    if splitter is None:
        raise HTTPException(status_code=404, detail="Splitter not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(splitter, field, value)
    await db.commit()
    await db.refresh(splitter)
    return splitter


@router.delete("/splitters/{splitter_id}", status_code=204)
async def delete_splitter(splitter_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    splitter = await db.get(Splitter, splitter_id)
    if splitter is None:
        raise HTTPException(status_code=404, detail="Splitter not found")
    await db.delete(splitter)
    await db.commit()


# ------------------------------------------------------------------ Fiber Loops
@router.get("/loops", response_model=list[FiberLoopOut])
async def list_loops(cable_id: int | None = None, db: AsyncSession = Depends(get_db)):
    q = select(FiberLoop).order_by(FiberLoop.id)
    if cable_id is not None:
        q = q.where(FiberLoop.cable_id == cable_id)
    res = await db.execute(q)
    return res.scalars().all()


@router.post("/loops", response_model=FiberLoopOut)
async def create_loop(body: FiberLoopCreate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    loop = FiberLoop(**body.model_dump())
    db.add(loop)
    await db.commit()
    await db.refresh(loop)
    return loop


@router.put("/loops/{loop_id}", response_model=FiberLoopOut)
async def update_loop(loop_id: int, body: FiberLoopUpdate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    loop = await db.get(FiberLoop, loop_id)
    if loop is None:
        raise HTTPException(status_code=404, detail="Loop not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(loop, field, value)
    await db.commit()
    await db.refresh(loop)
    return loop


@router.delete("/loops/{loop_id}", status_code=204)
async def delete_loop(loop_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    loop = await db.get(FiberLoop, loop_id)
    if loop is None:
        raise HTTPException(status_code=404, detail="Loop not found")
    await db.delete(loop)
    await db.commit()


# ------------------------------------------------------------------ Cable Cuts
@router.get("/cuts", response_model=list[CableCutOut])
async def list_cuts(cable_id: int | None = None, status: str | None = None, db: AsyncSession = Depends(get_db)):
    q = select(CableCut).order_by(CableCut.id.desc())
    if cable_id is not None:
        q = q.where(CableCut.cable_id == cable_id)
    if status is not None:
        q = q.where(CableCut.status == status)
    res = await db.execute(q)
    cuts = res.scalars().all()
    result = []
    for cut in cuts:
        cut.splice_tj_name = ""
        if cut.splice_tj_id:
            tj = await db.get(TjBox, cut.splice_tj_id)
            if tj:
                cut.splice_tj_name = tj.name
        result.append(cut)
    return result


@router.post("/cuts", response_model=CableCutOut)
async def create_cut(body: CableCutCreate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    cut = CableCut(**body.model_dump())
    db.add(cut)
    await db.commit()
    await db.refresh(cut)
    return cut


@router.put("/cuts/{cut_id}", response_model=CableCutOut)
async def update_cut(cut_id: int, body: CableCutUpdate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    cut = await db.get(CableCut, cut_id)
    if cut is None:
        raise HTTPException(status_code=404, detail="Cable cut not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(cut, field, value)
    await db.commit()
    await db.refresh(cut)
    cut.splice_tj_name = ""
    if cut.splice_tj_id:
        tj = await db.get(TjBox, cut.splice_tj_id)
        if tj:
            cut.splice_tj_name = tj.name
    return cut


@router.delete("/cuts/{cut_id}", status_code=204)
async def delete_cut(cut_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    cut = await db.get(CableCut, cut_id)
    if cut is None:
        raise HTTPException(status_code=404, detail="Cable cut not found")
    await db.delete(cut)
    await db.commit()


# ------------------------------------------------------------ Export / Import
@router.get("/export")
async def export_fiber(db: AsyncSession = Depends(get_db)):
    import openpyxl
    wb = openpyxl.Workbook()

    # TJ Boxes sheet
    ws = wb.active
    ws.title = "TJ Boxes"
    ws.append(["Name", "Type", "Capacity", "Trays", "Latitude", "Longitude", "Address", "Notes"])
    res = await db.execute(select(TjBox).order_by(TjBox.id))
    for t in res.scalars().all():
        ws.append([t.name, t.box_type, t.capacity, t.tray_count, t.lat, t.lng, t.address, t.notes])

    # Splitters sheet
    ws2 = wb.create_sheet("Splitters")
    ws2.append(["Name", "Split Ratio", "TJ Box Name", "Input Core", "Output Cores", "Latitude", "Longitude", "Notes"])
    res = await db.execute(select(Splitter).order_by(Splitter.id))
    for s in res.scalars().all():
        box_name = ""
        if s.tj_box_id:
            box = await db.get(TjBox, s.tj_box_id)
            box_name = box.name if box else ""
        ws2.append([s.name, s.split_ratio, box_name, s.input_core, s.output_cores, s.lat, s.lng, s.notes])

    # Cables sheet
    ws3 = wb.create_sheet("Cables")
    ws3.append(["Link ID", "Link Name", "Code", "Core Count", "Type", "Manufacturer", "Year", "Route Type", "Notes", "Segment Lat", "Segment Lng", "Segment End Lat", "Segment End Lng"])
    res = await db.execute(select(Cable).order_by(Cable.id))
    for c in res.scalars().all():
        segs = (await db.execute(select(CableSegment).where(CableSegment.cable_id == c.id).order_by(CableSegment.order_index))).scalars().all()
        if segs:
            for seg in segs:
                ws3.append([c.link_id, c.link_name, c.code, c.core_count, c.cable_type, c.manufacturer, c.manufacturing_year, c.route_type, c.notes,
                            seg.start_lat, seg.start_lng, seg.end_lat, seg.end_lng])
        else:
            ws3.append([c.link_id, c.link_name, c.code, c.core_count, c.cable_type, c.manufacturer, c.manufacturing_year, c.route_type, c.notes, "", "", "", ""])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=fiber_network.xlsx"})


@router.post("/import")
async def import_fiber(file: UploadFile = File(...), user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    import openpyxl
    content = await file.read()
    wb = openpyxl.load_workbook(io.BytesIO(content))
    imported = {"tj_boxes": 0, "splitters": 0, "cables": 0}

    # Find next IDs
    res = await db.execute(select(TjBox.unique_id).where(TjBox.unique_id.like("TJ-%")).order_by(TjBox.id.desc()).limit(1))
    last = res.scalar()
    tj_next = 5001
    if last:
        try: tj_next = int(last.split("-")[1]) + 1
        except: pass

    res = await db.execute(select(Splitter.unique_id).where(Splitter.unique_id.like("SP-%")).order_by(Splitter.id.desc()).limit(1))
    last = res.scalar()
    sp_next = 1001
    if last:
        try: sp_next = int(last.split("-")[1]) + 1
        except: pass

    # TJ Boxes
    if "TJ Boxes" in wb.sheetnames:
        ws = wb["TJ Boxes"]
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row[0]:
                continue
            box = TjBox(
                unique_id=f"TJ-{tj_next}",
                name=str(row[0] or ""), box_type=str(row[1] or "tj"),
                capacity=int(row[2] or 4), tray_count=int(row[3] or 1),
                lat=float(row[4] or 0), lng=float(row[5] or 0),
                address=str(row[6] or ""), notes=str(row[7] or ""),
            )
            db.add(box)
            tj_next += 1
            imported["tj_boxes"] += 1

    # Splitters
    if "Splitters" in wb.sheetnames:
        ws = wb["Splitters"]
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row[4] or not row[5]:
                continue
            tj_box_id = None
            if row[2]:
                box_res = await db.execute(select(TjBox).where(TjBox.name == str(row[2])))
                box = box_res.scalars().first()
                if box:
                    tj_box_id = box.id
            splitter = Splitter(
                unique_id=f"SP-{sp_next}",
                name=str(row[0] or ""), split_ratio=int(row[1] or 2),
                tj_box_id=tj_box_id, input_core=int(row[3] or 0),
                output_cores=str(row[4] or ""),
                lat=float(row[5] or 0), lng=float(row[6] or 0),
                notes=str(row[7] or ""),
            )
            db.add(splitter)
            sp_next += 1
            imported["splitters"] += 1

    # Cables
    if "Cables" in wb.sheetnames:
        ws = wb["Cables"]
        cable_cache: dict[str, Cable] = {}
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row[0]:
                continue
            link_id = str(row[0])
            if link_id not in cable_cache:
                # Auto-generate link_id if empty
                if not link_id:
                    max_res = await db.execute(select(Cable.id).order_by(Cable.id.desc()).limit(1))
                    max_id = max_res.scalar() or 0
                    link_id = f"LINK-{max_id + 1001}"
                cable = Cable(
                    link_id=link_id, link_name=str(row[1] or ""), code=str(row[2] or ""),
                    core_count=int(row[3] or 12), cable_type=str(row[4] or "round"),
                    manufacturer=str(row[5] or ""), manufacturing_year=int(row[6] or 0),
                    route_type=str(row[7] or "driving"), notes=str(row[8] or ""),
                )
                db.add(cable)
                await db.flush()
                cable_cache[link_id] = cable
                imported["cables"] += 1
            if row[9] and row[10] and row[11] and row[12]:
                seg = CableSegment(
                    cable_id=cable_cache[link_id].id,
                    start_lat=float(row[9]), start_lng=float(row[10]),
                    end_lat=float(row[11]), end_lng=float(row[12]),
                )
                db.add(seg)

    await db.commit()
    return imported


# ──────────────────────────────────────────────────────────────── splices

@router.get("/splices", response_model=list[SpliceOut])
async def list_splices(tj_id: int | None = None, limit: int = 200, offset: int = 0, db: AsyncSession = Depends(get_db)):
    q = select(Splice)
    if tj_id is not None:
        q = q.where(Splice.tj_id == tj_id)
    q = q.order_by(Splice.id).limit(limit).offset(offset)
    res = await db.execute(q)
    splices = res.scalars().all()
    # Batch cable lookup
    cable_ids = set()
    for sp in splices:
        cable_ids.add(sp.cable_a_id)
        cable_ids.add(sp.cable_b_id)
    cable_map = {}
    if cable_ids:
        cables_res = await db.execute(select(Cable.id, Cable.code).where(Cable.id.in_(cable_ids)))
        cable_map = {c.id: c.code for c in cables_res.all()}
    out = []
    for sp in splices:
        d = SpliceOut.model_validate(sp)
        d.cable_a_code = cable_map.get(sp.cable_a_id, "?")
        d.cable_b_code = cable_map.get(sp.cable_b_id, "?")
        out.append(d)
    return out


@router.post("/splices", response_model=SpliceOut, status_code=201, dependencies=[Depends(require_write)])
async def create_splice(body: SpliceCreate, db: AsyncSession = Depends(get_db)):
    splice = Splice(**body.model_dump())
    db.add(splice)
    await db.commit()
    await db.refresh(splice)
    cables_res = await db.execute(select(Cable).where(Cable.id.in_([splice.cable_a_id, splice.cable_b_id])))
    cable_map = {c.id: c.code for c in cables_res.scalars().all()}
    d = SpliceOut.model_validate(splice)
    d.cable_a_code = cable_map.get(splice.cable_a_id, "?")
    d.cable_b_code = cable_map.get(splice.cable_b_id, "?")
    return d


@router.put("/splices/{splice_id}", response_model=SpliceOut, dependencies=[Depends(require_write)])
async def update_splice(splice_id: int, body: SpliceUpdate, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Splice).where(Splice.id == splice_id))
    splice = res.scalar_one_or_none()
    if not splice:
        raise HTTPException(404, "Splice not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(splice, k, v)
    await db.commit()
    await db.refresh(splice)
    cables_res = await db.execute(select(Cable).where(Cable.id.in_([splice.cable_a_id, splice.cable_b_id])))
    cable_map = {c.id: c.code for c in cables_res.scalars().all()}
    d = SpliceOut.model_validate(splice)
    d.cable_a_code = cable_map.get(splice.cable_a_id, "?")
    d.cable_b_code = cable_map.get(splice.cable_b_id, "?")
    return d


@router.delete("/splices/{splice_id}", status_code=204, dependencies=[Depends(require_write)])
async def delete_splice(splice_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Splice).where(Splice.id == splice_id))
    splice = res.scalar_one_or_none()
    if not splice:
        raise HTTPException(404, "Splice not found")
    await db.delete(splice)
    await db.commit()


@router.get("/splices/unused-cores")
async def unused_cores(tj_id: int, db: AsyncSession = Depends(get_db)):
    """Return unused (spare) cores for each cable connected to a TJ."""
    tj_res = await db.execute(select(TjBox).where(TjBox.id == tj_id))
    tj = tj_res.scalar_one_or_none()
    if not tj:
        raise HTTPException(404, "TJ not found")
    # Find cable IDs connected to this TJ via segments (filter in query)
    from sqlalchemy import or_
    segs_res = await db.execute(
        select(CableSegment.cable_id).where(
            or_(
                ( CableSegment.start_lat.between(tj.lat - 0.001, tj.lat + 0.001)) & (CableSegment.start_lng.between(tj.lng - 0.001, tj.lng + 0.001)),
                (CableSegment.end_lat.between(tj.lat - 0.001, tj.lat + 0.001)) & (CableSegment.end_lng.between(tj.lng - 0.001, tj.lng + 0.001)),
            )
        ).distinct()
    )
    cable_ids = set(segs_res.scalars().all())
    if not cable_ids:
        return []
    # Get all splices at this TJ (only cable_id + core columns)
    splices_res = await db.execute(
        select(Splice.cable_a_id, Splice.core_a, Splice.cable_b_id, Splice.core_b)
        .where(Splice.tj_id == tj_id)
    )
    used = set()
    for row in splices_res.all():
        used.add((row.cable_a_id, row.core_a))
        used.add((row.cable_b_id, row.core_b))
    # Get cable info
    cables_res = await db.execute(select(Cable).where(Cable.id.in_(cable_ids)))
    cables = cables_res.scalars().all()
    result = []
    for c in cables:
        spare = [i for i in range(1, c.core_count + 1) if (c.id, i) not in used]
        if spare:
            result.append({"cable_id": c.id, "cable_code": c.code, "core_count": c.core_count, "spare_cores": spare})
    return result


@router.get("/noc-pop-map")
async def get_noc_pop_map(db: AsyncSession = Depends(get_db)):
    from ..models import Noc, Pop, OLTDevice
    nocs = (await db.execute(select(Noc))).scalars().all()
    pops = (await db.execute(select(Pop))).scalars().all()
    olts = (await db.execute(select(OLTDevice))).scalars().all()

    noc_items = []
    for n in nocs:
        devices = [o for o in olts if o.noc_id == n.id]
        noc_items.append({
            "id": n.id, "name": n.name, "type": "noc",
            "lat": n.gps_lat, "lng": n.gps_lng, "address": n.address,
            "contact_name": n.contact_name, "contact_phone": n.contact_phone,
            "device_count": len(devices),
            "devices": [{"id": d.id, "name": d.name, "ip": d.ip, "status": d.status, "pon_type": d.pon_type} for d in devices],
        })

    pop_items = []
    for p in pops:
        devices = [o for o in olts if o.pop_id == p.id]
        pop_items.append({
            "id": p.id, "name": p.name, "type": "pop",
            "lat": p.gps_lat, "lng": p.gps_lng, "address": p.address,
            "contact_name": p.contact_name, "contact_phone": p.contact_phone,
            "device_count": len(devices),
            "devices": [{"id": d.id, "name": d.name, "ip": d.ip, "status": d.status, "pon_type": d.pon_type} for d in devices],
        })

    return {"nocs": noc_items, "pops": pop_items}
