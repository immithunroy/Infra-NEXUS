"""Server-side photo processing pipeline.

Receives original photos from Android, applies Open Sans stamp with metadata,
crops/resizes to square ~2MP, compresses to JPEG < 1MB.

Pipeline:
    Receive Original Photo
        ↓
    Validate Metadata
        ↓
    Resize/Crop to Square
        ↓
    ~2 MP (1414x1414)
        ↓
    Apply Photo Stamp (Open Sans)
        ↓
    JPEG Compression (< 1 MB)
        ↓
    Store Processed Image
"""

import io
import logging
import os
from pathlib import Path
from datetime import datetime

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger("olt_commander.photo_processing")

# Constants
TARGET_SIZE = 1414  # ~2MP square image
MAX_FILE_SIZE = 1024 * 1024  # 1MB

# Font paths to try (Open Sans preferred, DejaVu Sans fallback)
FONT_PATHS = [
    "/usr/share/fonts/truetype/opensans/OpenSans-Regular.ttf",
    "/usr/share/fonts/truetype/opensans/OpenSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

FONT_BOLD_PATHS = [
    "/usr/share/fonts/truetype/opensans/OpenSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _find_font(paths: list[str], size: int) -> ImageFont.FreeTypeFont:
    """Find the first available font from the list."""
    for path in paths:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except (OSError, IOError):
                continue
    # Fallback to default
    return ImageFont.load_default()


def _format_timestamp(dt: datetime | str | None) -> str:
    """Format timestamp as 'DD-Mon-YYYY HH:mm:ss'."""
    if dt is None:
        return "N/A"
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return dt
    return dt.strftime("%d-%b-%Y %H:%M:%S")


def _apply_stamp(
    img: Image.Image,
    entity_type: str,
    entity_id: str,
    latitude: float | None,
    longitude: float,
    longitude_val: float | None,
    captured_at: datetime | str | None,
) -> Image.Image:
    """Apply Open Sans stamp to the image.
    
    For user photos:
        PPoE: <username>
        GPS: <lat>, <lng>
        Captured: <datetime>
    
    For TJ photos:
        TJ-ID: <tj_id>
        GPS: <lat>, <lng>
        Captured: <datetime>
    """
    # Convert to RGBA for compositing
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    
    # Create overlay for semi-transparent background
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Font sizes (12px at final image scale)
    font_size = 12
    font_bold = _find_font(FONT_BOLD_PATHS, font_size)
    font_regular = _find_font(FONT_PATHS, font_size)
    
    # Build stamp lines
    if entity_type == "user":
        label_id = "PPPoE:"
        value_id = entity_id
    else:
        label_id = "TJ-ID:"
        value_id = entity_id
    
    lat_str = f"{latitude:.6f}" if latitude is not None else "N/A"
    lng_str = f"{longitude_val:.6f}" if longitude_val is not None else "N/A"
    gps_text = f"{lat_str}, {lng_str}"
    
    captured_str = _format_timestamp(captured_at)
    
    line1 = f"{label_id} {value_id}"
    line2 = f"GPS: {gps_text}"
    line3 = f"Captured: {captured_str}"
    
    # Calculate text dimensions
    bbox1 = draw.textbbox((0, 0), line1, font=font_bold)
    bbox2 = draw.textbbox((0, 0), line2, font=font_regular)
    bbox3 = draw.textbbox((0, 0), line3, font=font_regular)
    
    line_h = bbox1[3] - bbox1[1] + 4
    total_h = (bbox1[3] - bbox1[1]) + (bbox2[3] - bbox2[1]) + (bbox3[3] - bbox3[1]) + 12
    
    # Position at bottom-left with padding
    padding = 10
    y_start = img.size[1] - total_h - padding
    
    # Calculate max width for background
    max_w = max(bbox1[2] - bbox1[0], bbox2[2] - bbox2[0], bbox3[2] - bbox3[0])
    
    # Draw semi-transparent background
    bg_rect = [padding - 4, y_start - 4, padding + max_w + 8, y_start + total_h + 8]
    draw.rounded_rectangle(bg_rect, radius=4, fill=(0, 0, 0, 140))
    
    # Draw text
    draw.text((padding, y_start), line1, fill="white", font=font_bold)
    draw.text((padding, y_start + line_h), line2, fill="white", font=font_regular)
    draw.text((padding, y_start + line_h * 2), line3, fill="white", font=font_regular)
    
    # Composite overlay onto image
    img = Image.alpha_composite(img, overlay)
    
    return img


def process_photo(
    image_bytes: bytes,
    entity_type: str,
    entity_id: str,
    latitude: float | None,
    longitude: float | None,
    captured_at: datetime | str | None,
    output_format: str = "JPEG",
    quality: int = 85,
) -> tuple[bytes, int, int]:
    """Process a photo: resize, crop, stamp, compress.
    
    Args:
        image_bytes: Original image bytes
        entity_type: "user" or "tj"
        entity_id: PPPoE username or TJ-ID
        latitude: GPS latitude
        longitude: GPS longitude
        captured_at: Photo capture timestamp
        output_format: Output format (JPEG)
        initial quality: Initial JPEG quality
        
    Returns:
        Tuple of (processed_bytes, width, height)
    """
    # Open image
    img = Image.open(io.BytesIO(image_bytes))
    
    # Convert to RGB if necessary
    if img.mode not in ("RGB",):
        img = img.convert("RGB")
    
    # Center-crop to square
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))
    
    # Resize to target size
    if img.size[0] != TARGET_SIZE:
        img = img.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
    
    # Apply stamp
    img = _apply_stamp(img, entity_type, entity_id, latitude, longitude, captured_at)
    
    # Convert back to RGB for JPEG
    if img.mode == "RGBA":
        img = img.convert("RGB")
    
    # Compress to JPEG with adaptive quality
    buf = io.BytesIO()
    current_quality = quality
    img.save(buf, format="JPEG", quality=current_quality, optimize=True)
    
    # Reduce quality if too large
    while buf.tell() > MAX_FILE_SIZE and current_quality > 30:
        buf = io.BytesIO()
        current_quality -= 10
        img.save(buf, format="JPEG", quality=current_quality, optimize=True)
    
    buf.seek(0)
    processed_bytes = buf.read()
    
    logger.info(
        "Photo processed: %dx%d, quality=%d, size=%d bytes",
        img.size[0], img.size[1], current_quality, len(processed_bytes)
    )
    
    return processed_bytes, img.size[0], img.size[1]


def process_approval_photo(
    original_path: str,
    entity_type: str,
    entity_id: str,
    latitude: float | None,
    longitude: float | None,
    captured_at: datetime | str | None,
) -> tuple[str, int, int, int]:
    """Process an approval photo and save the processed version.
    
    Args:
        original_path: Path to the original photo
        entity_type: "user" or "tj"
        entity_id: PPPoE username or TJ-ID
        latitude: GPS latitude
        longitude: GPS longitude
        captured_at: Photo capture timestamp
        
    Returns:
        Tuple of (processed_path, width, height, file_size)
    """
    # Read original
    with open(original_path, "rb") as f:
        image_bytes = f.read()
    
    # Process
    processed_bytes, width, height = process_photo(
        image_bytes, entity_type, entity_id, latitude, longitude, captured_at
    )
    
    # Save processed version
    original_p = Path(original_path)
    processed_path = original_p.parent / f"processed_{original_p.name}"
    
    with open(processed_path, "wb") as f:
        f.write(processed_bytes)
    
    file_size = len(processed_bytes)
    
    logger.info(
        "Approval photo processed: %s -> %s (%dx%d, %d bytes)",
        original_path, processed_path, width, height, file_size
    )
    
    return str(processed_path), width, height, file_size
