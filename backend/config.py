import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

ENV = os.getenv("ENV", "development").lower()
IS_PRODUCTION = ENV == "production"

MONGO_URI = os.getenv("MONGO_URI", "")
TRAVEL_GALLERY_COLLECTION = os.getenv("TRAVEL_GALLERY_COLLECTION", "TravelGalary").strip() or "TravelGalary"

JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
  if IS_PRODUCTION:
    raise RuntimeError("JWT_SECRET must be set in production")
  JWT_SECRET = secrets.token_urlsafe(48)

if IS_PRODUCTION and len(JWT_SECRET) < 32:
  raise RuntimeError("JWT_SECRET must be at least 32 characters when ENV=production")

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "12"))
PENDING_BOOKING_EXPIRE_HOURS = int(os.getenv("PENDING_BOOKING_EXPIRE_HOURS", "24"))

DEV_DEFAULT_ADMIN_PASSWORD = "WB_Admin@2026"

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "wb_admin").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", DEV_DEFAULT_ADMIN_PASSWORD).strip()

if IS_PRODUCTION:
  if len(ADMIN_PASSWORD) < 12:
    raise RuntimeError("ADMIN_PASSWORD must be at least 12 characters when ENV=production")
  if ADMIN_PASSWORD == DEV_DEFAULT_ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD cannot use the development default when ENV=production")

# How many reverse proxies sit in front of the API (nginx/Cloudflare = 1). Used to pick the real
# client IP from X-Forwarded-For without trusting values the visitor can forge. 0 = ignore the header.
TRUSTED_PROXY_HOPS = int(os.getenv("TRUSTED_PROXY_HOPS", "1" if IS_PRODUCTION else "0"))

# Admin-uploaded photos live here and are served by the API at /api/media/... (the website itself is
# hosted elsewhere, so files saved next to the API would otherwise never be reachable from the site).
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR") or (ROOT_DIR / "backend" / "uploads")).resolve()
# Public origin of the API, e.g. https://api.wonderbaboon.com  (used to build photo URLs stored in the DB)
MEDIA_PUBLIC_ORIGIN = (os.getenv("MEDIA_PUBLIC_ORIGIN") or "").strip().rstrip("/")
# Public origin of the website, used to build links inside emails (e.g. a new-story notice).
FRONTEND_PUBLIC_ORIGIN = (
  os.getenv("FRONTEND_PUBLIC_ORIGIN") or ("https://wonderbaboon.com" if IS_PRODUCTION else "http://localhost:3000")
).strip().rstrip("/")

PORT = int(os.getenv("PORT", "5051"))
HOST = os.getenv("HOST", "0.0.0.0")

_default_origins = (
  "http://localhost:3000,http://127.0.0.1:3000,"
  "http://localhost:5051,http://127.0.0.1:5051,"
  "http://localhost:5500,http://127.0.0.1:5500,"
  "http://localhost:8080,http://127.0.0.1:8080,"
  "http://localhost:4173,http://127.0.0.1:4173,"
  "https://wonderbaboon.com,https://www.wonderbaboon.com"
)
_cors_raw = os.getenv("CORS_ORIGINS")
if IS_PRODUCTION:
  if not (_cors_raw or "").strip():
    raise RuntimeError(
      "CORS_ORIGINS must be set explicitly when ENV=production "
      "(comma-separated https:// origins for your site)"
    )
  CORS_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()]
else:
  origins = [o.strip() for o in (_cors_raw or _default_origins).split(",") if o.strip()]
  # .env often copies production CORS only — keep localhost working in development.
  if (_cors_raw or "").strip():
    for origin in _default_origins.split(","):
      o = origin.strip()
      if o and ("localhost" in o or "127.0.0.1" in o) and o not in origins:
        origins.append(o)
  CORS_ORIGINS = origins

SMTP_HOST = (os.getenv("SMTP_HOST") or "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = (os.getenv("SMTP_USER") or "").strip()
SMTP_PASSWORD = (os.getenv("SMTP_PASSWORD") or "").strip().strip('"').strip("'")
SMTP_FROM = (os.getenv("SMTP_FROM") or SMTP_USER or "no-reply@wonderbaboon.local").strip()
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in {"1", "true", "yes"}

# New booking alerts (plain-text email). Unset → baboonwonder@gmail.com; set to empty string to disable.
_booking_notify = os.getenv("BOOKING_NOTIFY_EMAIL")
if _booking_notify is None:
  BOOKING_NOTIFY_EMAIL = "baboonwonder@gmail.com"
else:
  BOOKING_NOTIFY_EMAIL = _booking_notify.strip()

OTP_TTL_SECONDS = int(os.getenv("OTP_TTL_SECONDS", "600"))
OTP_RATE_LIMIT_SECONDS = int(os.getenv("OTP_RATE_LIMIT_SECONDS", "60"))

# Once an email passes OTP verification during signup, this is how long the user has to
# finish filling the rest of the form (mobile/password) without having to re-verify.
SIGNUP_VERIFICATION_EXPIRE_SECONDS = int(os.getenv("SIGNUP_VERIFICATION_EXPIRE_SECONDS", "1800"))

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

RAZORPAY_KEY_ID = (os.getenv("RAZORPAY_KEY_ID") or "").strip()
RAZORPAY_KEY_SECRET = (os.getenv("RAZORPAY_KEY_SECRET") or "").strip()
try:
  RAZORPAY_ADVANCE_PERCENT = int(os.getenv("RAZORPAY_ADVANCE_PERCENT", "30"))
except ValueError:
  RAZORPAY_ADVANCE_PERCENT = 30

try:
  RAZORPAY_ADVANCE_REFUND_DAYS = int(os.getenv("RAZORPAY_ADVANCE_REFUND_DAYS", "12"))
except ValueError:
  RAZORPAY_ADVANCE_REFUND_DAYS = 12

try:
  TRIP_COMPLETION_CHECK_INTERVAL_SECONDS = int(
    os.getenv("TRIP_COMPLETION_CHECK_INTERVAL_SECONDS", "3600")
  )
except ValueError:
  TRIP_COMPLETION_CHECK_INTERVAL_SECONDS = 3600
