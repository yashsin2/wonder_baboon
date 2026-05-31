import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

ENV = os.getenv("ENV", "development").lower()
IS_PRODUCTION = ENV == "production"

MONGO_URI = os.getenv("MONGO_URI", "")

JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
  if IS_PRODUCTION:
    raise RuntimeError("JWT_SECRET must be set in production")
  JWT_SECRET = secrets.token_urlsafe(48)

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "12"))

DEV_DEFAULT_ADMIN_PASSWORD = "WB_Admin@2026"

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "wb_admin").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", DEV_DEFAULT_ADMIN_PASSWORD).strip()

if IS_PRODUCTION:
  if len(ADMIN_PASSWORD) < 12:
    raise RuntimeError("ADMIN_PASSWORD must be at least 12 characters when ENV=production")
  if ADMIN_PASSWORD == DEV_DEFAULT_ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD cannot use the development default when ENV=production")

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
