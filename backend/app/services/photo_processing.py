"""Server-side photo processing pipeline.

Processes photos submitted from the Android app and web frontend.

Stamp format — USER photos:
    PPPoE Username: <username>
    Date & Time:    03 Sep 2026, 05:28 PM
    GPS:            22.701234, 90.353456

Stamp format — TJ photos:
    TJ ID:          TJ-00125
    Date & Time:    03 Sep 2026, 05:28 PM
    GPS:            22.701234, 90.353456

Pipeline:
    1. Validate photo and required metadata
    2. Correct image orientation (EXIF)
    3. Crop to square (center)
    4. Resize to 1440×1440 (~2 MP)
    5. Apply stamp (Open Sans 12, bottom-left, 30px margin)
    6. JPEG compress — progressive quality reduction until < 1 MB
    7. Return processed bytes, width, height
"""

import io
import logging
import os
import re
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ExifTags

logger = logging.getLogger("olt_commander.photo_processing")

# Constants
TARGET_SIZE = 1440
MAX_FILE_SIZE = 1024 * 1024  # 1 MB
MARGIN_PX = 30
STAMP_FONT_SIZE = 12
INITIAL_QUALITY = 85
MIN_QUALITY = 30
QUALITY_STEP = 5

# Font search paths — Open Sans preferred, Liberation/DejaVu fallback
_FONT_DIRS = [
    "/usr/share/fonts/truetype/opensans",
    "/usr/share/fonts/truetype/liberation",
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype",
    "/usr/share/fonts",
]

_FONT_NAMES = {
    "regular": ["OpenSans-Regular.ttf", "LiberationSans-Regular.ttf", "DejaVuSans.ttf", "FreeSans.ttf"],
    "bold": ["OpenSans-Bold.ttf", "LiberationSans-Bold.ttf", "DejaVuSans-Bold.ttf", "FreeSansBold.ttf"],
}


def _find_font(variant: str, size: int) -> ImageFont.FreeTypeFont:
    """Find the first available font by variant (regular/bold)."""
    names = _FONT_NAMES.get(variant, _FONT_NAMES["regular"])
    for font_dir in _FONT_DIRS:
        for name in names:
            path = os.path.join(font_dir, name)
            if os.path.isfile(path):
                try:
                    return ImageFont.truetype(path, size)
                except (OSError, IOError):
                    continue
    logger.warning("No TrueType font found — falling back to default bitmap font")
    return ImageFont.load_default()


def _format_timestamp(dt: datetime | str | None) -> str:
    """Format as '03 Sep 2026, 05:28 PM'."""
    if dt is None:
        return "N/A"
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return dt
    return dt.strftime("%d %b %Y, %I:%M %p")


def _correct_exif_orientation(img: Image.Image) -> Image.Image:
    """Rotate/flip image according to EXIF orientation tag."""
    try:
        exif_data = img.getexif()
    except Exception:
        return img

    if not exif_data:
        return img

    orientation_key = None
    for k, v in ExifTags.TAGS.items():
        if v == "Orientation":
            orientation_key = k
            break

    if orientation_key is None:
        return img

    orientation = exif_data.get(orientation_key)
    if orientation is None:
        return img

    method = {
        2: Image.FLIP_LEFT_RIGHT,
        3: Image.ROTATE_180,
        4: Image.FLIP_TOP_BOTTOM,
        5: Image.TRANSPOSE,
        6: Image.ROTATE_270,
        7: Image.TRANSVERSE,
        8: Image.ROTATE_90,
    }.get(orientation)

    if method is not None:
        img = img.transpose(method)

    return img


def _apply_stamp(
    img: Image.Image,
    entity_type: str,
    entity_id: str,
    latitude: float | None,
    longitude: float | None,
    gps_accuracy: float | None,
    captured_at: datetime | str | None,
) -> Image.Image:
    """Apply information stamp to the bottom-left corner of the image.

    USER photos:  PPPoE Username + Date & Time + GPS + GPS Accuracy
    TJ photos:    TJ ID + Date & Time + GPS + GPS Accuracy
    """
    font_bold = _find_font("bold", STAMP_FONT_SIZE)
    font_regular = _find_font("regular", STAMP_FONT_SIZE)

    # Build label + value pairs — labels are bold, values are regular
    if entity_type == "user":
        label1, value1 = "PPPoE Username:", entity_id
    else:
        label1, value1 = "TJ ID:", entity_id

    label2, value2 = "Date & Time:", _format_timestamp(captured_at)

    lat_str = f"{latitude:.6f}" if latitude is not None else "N/A"
    lng_str = f"{longitude:.6f}" if longitude is not None else "N/A"
    label3, value3 = "GPS:", f"{lat_str}, {lng_str}"

    label4, value4 = "GPS Accuracy:", f"{gps_accuracy:.1f} m" if gps_accuracy is not None else "N/A"

    # Measure each line
    bbox_l1 = font_bold.getbbox(label1)
    bbox_v1 = font_regular.getbbox(f" {value1}")
    bbox_l2 = font_bold.getbbox(label2)
    bbox_v2 = font_regular.getbbox(f" {value2}")
    bbox_l3 = font_bold.getbbox(label3)
    bbox_v3 = font_regular.getbbox(f" {value3}")
    bbox_l4 = font_bold.getbbox(label4)
    bbox_v4 = font_regular.getbbox(f" {value4}")

    line_height = STAMP_FONT_SIZE + 4
    num_lines = 4
    total_h = line_height * num_lines

    x = MARGIN_PX
    y_start = img.size[1] - total_h - MARGIN_PX

    # Convert to RGBA for compositing
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Measure total width for background rect
    w1 = (bbox_l1[2] - bbox_l1[0]) + (bbox_v1[2] - bbox_v1[0])
    w2 = (bbox_l2[2] - bbox_l2[0]) + (bbox_v2[2] - bbox_v2[0])
    w3 = (bbox_l3[2] - bbox_l3[0]) + (bbox_v3[2] - bbox_v3[0])
    w4 = (bbox_l4[2] - bbox_l4[0]) + (bbox_v4[2] - bbox_v4[0])
    max_w = max(w1, w2, w3, w4)

    # Semi-transparent background
    bg_pad = 6
    bg_rect = [
        x - bg_pad,
        y_start - bg_pad,
        x + max_w + bg_pad,
        y_start + total_h + bg_pad,
    ]
    draw.rounded_rectangle(bg_rect, radius=4, fill=(0, 0, 0, 150))

    # Draw each line: bold label + regular value
    lines = [
        (label1, value1, font_bold, font_regular),
        (label2, value2, font_bold, font_regular),
        (label3, value3, font_bold, font_regular),
        (label4, value4, font_bold, font_regular),
    ]
    for i, (lbl, val, f_bold, f_reg) in enumerate(lines):
        y = y_start + i * line_height
        draw.text((x, y), lbl, fill="white", font=f_bold)
        lbl_w = f_bold.getbbox(lbl)[2] - f_bold.getbbox(lbl)[0]
        draw.text((x + lbl_w, y), f" {val}", fill="white", font=f_reg)

    img = Image.alpha_composite(img, overlay)
    return img


def process_photo(
    image_bytes: bytes,
    entity_type: str,
    entity_id: str,
    latitude: float | None,
    longitude: float | None,
    gps_accuracy: float | None,
    captured_at: datetime | str | None,
) -> tuple[bytes, int, int]:
    """Full processing pipeline: EXIF → crop → resize → stamp → compress.

    Args:
        image_bytes:  Original image bytes (any format).
        entity_type:  "user" | "tj".
        entity_id:    PPPoE username or TJ ID.
        latitude:     GPS latitude  (-90..90).
        longitude:    GPS longitude (-180..180).
        gps_accuracy: GPS accuracy in meters (>= 0).
        captured_at:  Capture timestamp.

    Returns:
        (processed_jpeg_bytes, width, height)

    Raises:
        ValueError: If the image cannot be processed.
    """
    # --- 1. Open ---
    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception as e:
        raise ValueError(f"Cannot open image: {e}") from e

    # --- 2. Correct EXIF orientation ---
    img = _correct_exif_orientation(img)

    # --- 3. Convert to RGB ---
    if img.mode not in ("RGB",):
        img = img.convert("RGB")

    # --- 4. Center-crop to square ---
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))

    # --- 5. Resize to target ---
    if img.size[0] != TARGET_SIZE:
        img = img.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)

    # --- 6. Apply stamp ---
    img = _apply_stamp(img, entity_type, entity_id, latitude, longitude, gps_accuracy, captured_at)

    # --- 7. Convert to RGB for JPEG ---
    if img.mode == "RGBA":
        img = img.convert("RGB")

    # --- 8. Progressive JPEG compression (< 1 MB) ---
    buf = io.BytesIO()
    quality = INITIAL_QUALITY
    img.save(buf, format="JPEG", quality=quality, optimize=True)

    while buf.tell() > MAX_FILE_SIZE and quality > MIN_QUALITY:
        buf = io.BytesIO()
        quality -= QUALITY_STEP
        img.save(buf, format="JPEG", quality=quality, optimize=True)

    if buf.tell() > MAX_FILE_SIZE:
        # Last resort: reduce resolution slightly
        scale = 0.9
        while buf.tell() > MAX_FILE_SIZE and scale > 0.5:
            buf = io.BytesIO()
            reduced = img.resize(
                (int(TARGET_SIZE * scale), int(TARGET_SIZE * scale)),
                Image.LANCZOS,
            )
            reduced.save(buf, format="JPEG", quality=MIN_QUALITY, optimize=True)
            scale -= 0.05

    buf.seek(0)
    processed = buf.read()

    if len(processed) > MAX_FILE_SIZE:
        raise ValueError(f"Could not compress image below {MAX_FILE_SIZE // 1024} KB")

    logger.info(
        "Photo processed: %dx%d, quality=%d, size=%d bytes",
        img.size[0], img.size[1], quality, len(processed),
    )
    return processed, img.size[0], img.size[1]


def process_approval_photo(
    original_path: str,
    entity_type: str,
    entity_id: str,
    latitude: float | None,
    longitude: float | None,
    gps_accuracy: float | None,
    captured_at: datetime | str | None,
) -> tuple[str, int, int, int]:
    """Process an approval photo, save processed version, return metadata."""
    with open(original_path, "rb") as f:
        image_bytes = f.read()

    processed_bytes, width, height = process_photo(
        image_bytes, entity_type, entity_id, latitude, longitude, gps_accuracy, captured_at,
    )

    original_p = Path(original_path)
    processed_path = original_p.parent / f"processed_{original_p.name}"
    with open(processed_path, "wb") as f:
        f.write(processed_bytes)

    file_size = len(processed_bytes)
    logger.info("Approval photo processed: %s -> %s (%dx%d, %d bytes)",
                original_path, processed_path, width, height, file_size)
    return str(processed_path), width, height, file_size
