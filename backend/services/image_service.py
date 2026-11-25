import io
import logging
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from PIL import Image, ImageOps, UnidentifiedImageError

from config import UPLOAD_DIR

logger = logging.getLogger(__name__)

# iPhones save camera-roll photos as HEIC/HEIF by default — without this, every such photo
# a traveller picks straight from their camera roll fails to upload. Pillow can't read HEIC on
# its own, so pillow-heif registers a decoder for it as just another Pillow-openable format.
try:
  import pillow_heif

  pillow_heif.register_heif_opener()
  _HEIF_AVAILABLE = True
except Exception:  # pragma: no cover - only hit if the optional dependency is missing
  logger.warning("pillow-heif not available; HEIC/HEIF photo uploads will be rejected")
  _HEIF_AVAILABLE = False

BLOG_DIR = "blog"
# This only bounds the *upload* (bandwidth/time and how much raw bytes we hold in memory
# before processing) — every photo is re-encoded to a small WebP regardless of how big the
# original was, so raising this doesn't change what ends up on disk. The real guard against a
# memory-exhaustion ("decompression bomb") attack is MAX_PIXELS below, which caps the decoded
# image regardless of file size.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 50_000_000
FULL_EDGE = 1600
THUMB_EDGE = 600
# MPO is what Pillow calls an iPhone Portrait-mode (or some dual-camera Android) photo: a plain
# JPEG with a second "depth" frame tacked on for the background-blur effect. It is not a separate
# format a traveller chose — it is what the Camera app produces — and Pillow decodes its first
# frame exactly like an ordinary JPEG, so treat it as one rather than rejecting a real photo.
ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"} | ({"HEIF"} if _HEIF_AVAILABLE else set())

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class ImageRejected(ValueError):
  pass


def _encode(img: Image.Image, edge: int, quality: int) -> bytes:
  copy = img.copy()
  copy.thumbnail((edge, edge), Image.LANCZOS)
  buf = io.BytesIO()
  copy.save(buf, format="WEBP", quality=quality, method=4)
  return buf.getvalue()


def process_and_store(data: bytes, public_origin: str) -> Dict[str, Any]:
  """Validate by decoding, strip metadata, resize and store as WebP. Returns the image record."""
  if len(data) > MAX_UPLOAD_BYTES:
    raise ImageRejected("image must be 20MB or smaller")
  try:
    probe = Image.open(io.BytesIO(data))
    if probe.format not in ALLOWED_FORMATS:
      raise ImageRejected("upload a JPG, PNG, WEBP or HEIC photo" if _HEIF_AVAILABLE else "upload a JPG, PNG or WEBP image")
    probe.verify()
    img = Image.open(io.BytesIO(data))
    img.load()
  except ImageRejected:
    raise
  except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError):
    raise ImageRejected("file is not a valid image")

  # exif_transpose bakes the camera rotation into the pixels; re-encoding then drops all EXIF/GPS.
  img = ImageOps.exif_transpose(img)
  if img.mode not in ("RGB", "RGBA"):
    img = img.convert("RGBA" if "transparency" in img.info else "RGB")

  full_bytes = _encode(img, FULL_EDGE, 82)
  thumb_bytes = _encode(img, THUMB_EDGE, 78)
  w, h = img.size
  scale = min(1.0, FULL_EDGE / max(w, h))
  out_w, out_h = max(1, round(w * scale)), max(1, round(h * scale))

  now = datetime.utcnow()
  rel_dir = Path(BLOG_DIR) / f"{now.year:04d}" / f"{now.month:02d}"
  folder = UPLOAD_DIR / rel_dir
  folder.mkdir(parents=True, exist_ok=True)
  stem = uuid.uuid4().hex
  (folder / f"{stem}_full.webp").write_bytes(full_bytes)
  (folder / f"{stem}_thumb.webp").write_bytes(thumb_bytes)
  base = f"{public_origin}/api/media/{rel_dir.as_posix()}/{stem}"
  return {"full": f"{base}_full.webp", "thumb": f"{base}_thumb.webp", "w": out_w, "h": out_h}


def _local_path(url: str) -> Optional[Path]:
  marker = "/api/media/"
  idx = url.find(marker)
  if idx < 0:
    return None
  rel = url[idx + len(marker):]
  if not rel.startswith(f"{BLOG_DIR}/") or ".." in rel:
    return None
  path = (UPLOAD_DIR / rel).resolve()
  try:
    path.relative_to(UPLOAD_DIR)
  except ValueError:
    return None
  return path


def delete_image(image: Dict[str, Any]) -> None:
  for key in ("full", "thumb"):
    path = _local_path(str(image.get(key, "")))
    if path and path.exists():
      try:
        path.unlink()
      except OSError as error:
        logger.warning("could not delete %s: %s", path, error)


def sweep_orphans(referenced: set, max_age_seconds: int = 86400) -> int:
  """Delete blog image files older than max_age that no post references."""
  root = UPLOAD_DIR / BLOG_DIR
  if not root.exists():
    return 0
  cutoff = time.time() - max_age_seconds
  removed = 0
  for path in root.rglob("*.webp"):
    try:
      if path.stat().st_mtime > cutoff:
        continue
      stem = path.name.rsplit("_", 1)[0]
      if stem in referenced:
        continue
      path.unlink()
      removed += 1
    except OSError:
      continue
  return removed
