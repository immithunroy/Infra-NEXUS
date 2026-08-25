import hashlib
import math

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import OLTDevice, Onu, User
from ..schemas import MapPoint, MapPointResponse
from ..security import get_current_user
from ..utils.status import display_status

router = APIRouter(prefix="/api/map", tags=["map"], dependencies=[Depends(get_current_user)])

# Default center for ONUs without GPS: scatter around this point.
CITY_LAT = 22.80117038571286
CITY_LNG = 90.30111252073529
_RADIUS_M = 500


def _scatterGPS(lat: float, lng: float, onu_id: int) -> tuple[float, float]:
    """Deterministic scatter within _Radius_M of center using onu_id as seed."""
    h = int(hashlib.md5(str(onu_id).encode()).hexdigest()[:8], 16)
    angle = (h % 3600) / 10.0  # 0-359.9 degrees
    # vary radius: 50-500 m
    r = 50 + (h % 451)
    dlat = r * math.cos(math.radians(angle)) / 111320
    dlng = r * math.sin(math.radians(angle)) / (111320 * math.cos(math.radians(lat)))
    return round(lat + dlat, 6), round(lng + dlng, 6)


@router.get("/points", response_model=MapPointResponse)
async def map_points(db: AsyncSession = Depends(get_db)):
    """ONUs for the network map.

    ONUs with GPS are placed at their real location.
    ONUs without GPS are scattered within 500 m of the city center (airport)
    so they are visible; once an employee adds coordinates they move to the
    actual spot.
    """
    onus = (
        await db.execute(select(Onu).order_by(Onu.olt_id, Onu.pon_port, Onu.onu_id))
    ).scalars().all()
    olts = {d.id: d for d in (await db.execute(select(OLTDevice))).scalars()}

    points: list[MapPoint] = []
    for o in onus:
        state = o.state.value if hasattr(o.state, "value") else str(o.state)
        olt = olts.get(o.olt_id)
        if o.gps_lat is not None and o.gps_lng is not None:
            lat, lng = o.gps_lat, o.gps_lng
        else:
            lat, lng = _scatterGPS(CITY_LAT, CITY_LNG, o.id)
        points.append(
            MapPoint(
                onu_id=o.id,
                olt_id=o.olt_id,
                olt_name=olt.name if olt else "",
                pon_port=o.pon_port,
                name=o.name,
                subscriber=o.subscriber,
                serial=o.serial,
                gps_lat=lat,
                gps_lng=lng,
                gps_accuracy=o.gps_accuracy,
                state=state,
                status=display_status(state, o.bound, o.down_reason or ""),
                down_reason=o.down_reason or "",
                bound=o.bound,
                rx_power=o.rx_power,
                address=o.address,
                last_seen=o.last_seen,
            )
        )
    return MapPointResponse(city_lat=CITY_LAT, city_lng=CITY_LNG, points=points)
