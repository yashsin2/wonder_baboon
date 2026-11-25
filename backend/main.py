import hashlib
import hmac
import logging
import re
import threading
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from auth_utils import (
  create_pending_booking_token,
  create_token,
  decode_pending_booking_token,
  decode_token,
  hash_password,
  require_admin,
  sanitize_text,
  verify_password,
)
from config import (
  CORS_ORIGINS,
  FRONTEND_PUBLIC_ORIGIN,
  HOST,
  IS_PRODUCTION,
  JWT_SECRET,
  PORT,
  RAZORPAY_ADVANCE_REFUND_DAYS,
  RAZORPAY_KEY_ID,
  MEDIA_PUBLIC_ORIGIN,
  ROOT_DIR,
  UPLOAD_DIR,
)
from logging_setup import configure_logging
from models import (
  AddMembersRequest,
  BlogCommentRequest,
  BlogDiscardUploadRequest,
  BlogModerateRequest,
  BlogPostRequest,
  BlogReportRequest,
  AdminConfirmBookingRequest,
  AdminConfirmPaymentFields,
  AdminMarkFullPaymentRequest,
  AdminTripCreateRequest,
  AdminTripUpdateRequest,
  EmailOtpRequest,
  GuestBookingRequest,
  MobileOtpRequest,
  OtpVerifyRequest,
  PlannedTripRequest,
  ProfileNameUpdateRequest,
  RazorpayCreateOrderRequest,
  RazorpayVerifyRequest,
  TravelerContact,
  TravelGalleryPlaceRequest,
  TravelGalleryStateRequest,
  TravelGalleryVisitRequest,
  UnifiedLoginRequest,
  UserSignupRequest,
)
from middleware.auth_rate_limit import auth_rate_limit_middleware, client_ip
from services import blog_service, image_service
from services.email_service import email_service
from services.itinerary_pdf import pdf_bytes_to_itinerary_html
from services.mongo_service import mongo_service
from services.otp_service import otp_service
from services.trip_completion_service import (
  process_trip_completion_emails,
  send_test_trip_completed_email,
  start_trip_completion_worker,
)
from services.razorpay_service import (
  MIN_AMOUNT_PAISE,
  RazorpayAuthError,
  RazorpayOrderError,
  advance_percent,
  compute_advance_inr,
  create_order as razorpay_create_order,
  razorpay_enabled,
  reset_client as razorpay_reset_client,
  verify_payment_signature,
)

if not JWT_SECRET:
  raise RuntimeError("JWT_SECRET is required")

configure_logging()
logger = logging.getLogger("wb.main")


MAX_JSON_BODY = 1 * 1024 * 1024
MAX_UPLOAD_BODY = 64 * 1024 * 1024
SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-site",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}
if IS_PRODUCTION:
  SECURITY_HEADERS["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"


def _public_payment_error(error: Exception, fallback: str) -> str:
  """Gateway/config error text is for the server log; visitors only get a neutral message."""
  return fallback if IS_PRODUCTION else (str(error) or fallback)


_login_failures: Dict[str, List[float]] = {}
_login_failures_lock = threading.Lock()
LOGIN_FAIL_MAX = 8
LOGIN_FAIL_WINDOW = 15 * 60


def _login_locked(identifier: str) -> bool:
  now = time.monotonic()
  with _login_failures_lock:
    hits = [t for t in _login_failures.get(identifier, []) if t > now - LOGIN_FAIL_WINDOW]
    _login_failures[identifier] = hits
    return len(hits) >= LOGIN_FAIL_MAX


def _login_failed(identifier: str) -> None:
  with _login_failures_lock:
    if len(_login_failures) > 20000:
      _login_failures.clear()
    _login_failures.setdefault(identifier, []).append(time.monotonic())


def _login_ok(identifier: str) -> None:
  with _login_failures_lock:
    _login_failures.pop(identifier, None)


def _inr_label(amount: int) -> str:
  try:
    n = int(amount)
  except (TypeError, ValueError):
    return "₹—"
  return f"₹{n:,}"


def _payment_amounts_for_kind(package_total: int, payment_kind: str) -> tuple[int, int, int]:
  """Return (pay_now_inr, balance_inr, amount_paise) for advance or full payment."""
  total = max(1, int(package_total))
  kind = (payment_kind or "advance").strip()
  if kind == "full":
    return total, 0, max(MIN_AMOUNT_PAISE, total * 100)
  advance_inr, balance_inr = compute_advance_inr(total)
  return advance_inr, balance_inr, max(MIN_AMOUNT_PAISE, advance_inr * 100)


def _run_email_background(fn, *args, **kwargs) -> None:
  """Send email off the request thread so admin actions return immediately."""
  threading.Thread(target=fn, args=args, kwargs=kwargs, daemon=True).start()


def _admin_confirm_booking_payment(
  booking_id: str,
  advance_payment_inr: int,
  trip_total_override: Optional[int],
) -> Dict[str, Any]:
  cleaned_id = (booking_id or "").strip()
  if not cleaned_id:
    raise HTTPException(status_code=404, detail="booking not found")
  booking = mongo_service.find_booking_by_id(cleaned_id)
  if not booking:
    raise HTTPException(status_code=404, detail="booking not found")
  if booking.get("payment") == "paid":
    raise HTTPException(status_code=400, detail="This booking is already fully paid.")
  if booking.get("payment") == "advance_paid":
    raise HTTPException(
      status_code=400,
      detail="Advance already recorded. Use “Mark full payment received” when the balance is paid.",
    )

  package_total = mongo_service.package_total_inr_for_booking(booking, trip_total_override)
  if package_total is None:
    raise HTTPException(
      status_code=400,
      detail="Enter the full package total (₹) before confirming planned trips—or when "
      "this catalogue booking no longer has a published price.",
    )
  advance = int(advance_payment_inr)
  if advance < 1:
    raise HTTPException(status_code=400, detail="Enter the advance amount received (minimum ₹1).")
  if advance > package_total:
    raise HTTPException(
      status_code=400,
      detail=(
        f"Advance ({_inr_label(advance)}) cannot exceed the package total ({_inr_label(package_total)})."
      ),
    )
  balance = package_total - advance
  ok = mongo_service.confirm_booking_with_payment_breakdown(cleaned_id, package_total, advance, balance)
  if not ok:
    raise HTTPException(status_code=404, detail="booking not found")

  payment_status = "paid" if balance <= 0 else "advance_paid"
  refreshed = mongo_service.find_booking_by_id(cleaned_id)
  traveler_email = ""
  if refreshed:
    traveler_email = str(refreshed.get("email") or "").strip()

  payload_for_mail = refreshed or booking
  if traveler_email:
    if payment_status == "paid":
      _run_email_background(
        email_service.notify_full_payment_received_traveler,
        traveler_email,
        payload_for_mail,
        package_total_inr=package_total,
      )
    else:
      _run_email_background(
        email_service.notify_booking_confirmed_traveler,
        traveler_email,
        payload_for_mail,
        package_total_inr=package_total,
        advance_payment_inr=advance,
        balance_due_inr=balance,
      )
  else:
    logger.warning("booking %s payment recorded but traveler has no email; skipping mail", cleaned_id)

  logger.info(
    "admin recorded booking payment id=%s status=%s total=%s advance=%s balance=%s",
    cleaned_id,
    payment_status,
    package_total,
    advance,
    balance,
  )
  return {
    "message": "booking confirmed" if payment_status == "paid" else "advance payment recorded",
    "payment": payment_status,
    "package_total_inr": package_total,
    "advance_payment_inr": advance,
    "balance_due_inr": max(0, balance),
  }


def _admin_mark_booking_fully_paid(booking_id: str) -> Dict[str, Any]:
  cleaned_id = (booking_id or "").strip()
  if not cleaned_id:
    raise HTTPException(status_code=404, detail="booking not found")
  booking = mongo_service.find_booking_by_id(cleaned_id)
  if not booking:
    raise HTTPException(status_code=404, detail="booking not found")
  if booking.get("payment") == "paid":
    raise HTTPException(status_code=400, detail="This booking is already fully paid.")
  if booking.get("payment") != "advance_paid":
    raise HTTPException(status_code=400, detail="Record advance payment before marking full payment.")

  updated = mongo_service.mark_booking_fully_paid(cleaned_id)
  if not updated:
    raise HTTPException(status_code=400, detail="Could not mark booking as fully paid.")

  package_total = int(updated.get("packageTotalInr") or 0)
  traveler_email = str(updated.get("email") or "").strip()
  if traveler_email:
    _run_email_background(
      email_service.notify_full_payment_received_traveler,
      traveler_email,
      updated,
      package_total_inr=package_total,
    )
  else:
    logger.warning("booking %s fully paid but traveler has no email; skipping mail", cleaned_id)

  logger.info("admin marked booking fully paid id=%s total=%s", cleaned_id, package_total)
  return {
    "message": "full payment recorded",
    "payment": "paid",
    "package_total_inr": package_total,
    "advance_payment_inr": package_total,
    "balance_due_inr": 0,
  }


def _traveler_document_fields(
  primary_name: str,
  additional: List[str],
  contacts: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
  """Ordered travelers + traveler1..travelerN for storage and emails.

  `contacts` are the additional travelers' {name, mobile, email}; stored as travelerContacts so each
  of them sees this trip once they log in with that email / mobile.
  """
  primary = sanitize_text(str(primary_name).strip(), "full_name")
  names: List[str] = [primary]
  for extra in additional:
    names.append(sanitize_text(str(extra).strip(), "full_name"))
  out: Dict[str, Any] = {"travelers": names}
  for i, nm in enumerate(names, start=1):
    if i <= 20:
      out[f"traveler{i}"] = nm
  if contacts is not None:
    out["travelerContacts"] = [
      {"name": c["name"], "mobile": c["mobile"], "email": str(c["email"]).strip().lower()} for c in contacts
    ]
  return out


def _locked_travel_date(trip: Optional[dict], requested: str) -> str:
  """Catalogue trips run on the trip's own start date; travelers cannot pick another one."""
  fixed = str((trip or {}).get("startDate") or "").strip()
  return fixed or requested


def _traveler_inbox_email(booking_doc: Dict[str, Any]) -> str:
  raw = booking_doc.get("email")
  if raw is None:
    return ""
  s = str(raw).strip().lower()
  return s if s and "@" in s else ""


def _notify_booking_created(doc: Dict[str, Any]) -> None:
  """Ops alert + traveller acknowledgement when online advance is not required."""
  email_service.notify_new_booking(doc, payment_pending=False)
  inbox = _traveler_inbox_email(doc)
  if inbox:
    estimate = mongo_service.package_total_inr_for_booking(doc, None)
    email_service.notify_booking_pending_traveler(inbox, doc, package_total_inr=estimate)


def _notify_admin_booking_attempt(doc: Dict[str, Any]) -> None:
  """Ops alert only — traveller is emailed after Razorpay advance succeeds."""
  email_service.notify_new_booking(doc, payment_pending=True)


def _save_catalogue_booking(doc: Dict[str, Any]) -> Dict[str, Any]:
  """Persist catalogue booking or hold in a signed token until Razorpay advance succeeds."""
  if razorpay_enabled():
    mongo_service.ensure_ready()
    doc["confirmed"] = False
    doc["requiresOnlineAdvance"] = True
    if "createdAt" not in doc:
      doc["createdAt"] = datetime.utcnow()
    _run_email_background(_notify_admin_booking_attempt, doc)
    inbox = _traveler_inbox_email(doc)
    if inbox:
      estimate = mongo_service.package_total_inr_for_booking(doc, None)
      _run_email_background(
        email_service.notify_booking_pending_traveler,
        inbox,
        doc,
        package_total_inr=estimate,
      )
    pending_token = create_pending_booking_token(doc)
    logger.info(
      "booking attempt (not saved until advance) trip=%s email=%s",
      doc.get("travelDestination"),
      doc.get("email"),
    )
    return _booking_response(pending_token=pending_token)

  booking_id = mongo_service.insert_booking(doc)
  _notify_booking_created(doc)
  return _booking_response(booking_id=booking_id)


def _booking_response(
  *,
  booking_id: Optional[str] = None,
  pending_token: Optional[str] = None,
) -> Dict[str, Any]:
  if pending_token:
    out: Dict[str, Any] = {
      "message": "details received — complete advance payment to confirm your seat",
      "pending_token": pending_token,
      "saved_to_database": False,
    }
  else:
    out = {"message": "booking saved", "booking_id": booking_id, "saved_to_database": True}
  if razorpay_enabled():
    out["razorpay_enabled"] = True
    out["advance_percent"] = advance_percent()
    out["advance_refund_days"] = RAZORPAY_ADVANCE_REFUND_DAYS
    out["requires_payment_to_confirm"] = True
  return out


def _booking_belongs_to_user(booking: dict, email: str, mobile: Optional[str]) -> bool:
  b_email = str(booking.get("email") or "").strip().lower()
  b_mobile = str(booking.get("mobile") or "").strip()
  if b_email and b_email == email.strip().lower():
    return True
  if mobile and b_mobile and b_mobile == mobile.strip():
    return True
  return False


def _apply_booking_member_update(
  booking_id: str,
  additional_contacts: List[Dict[str, str]],
  triggered_by: str,
) -> Dict[str, Any]:
  additional_travelers = [c["name"] for c in additional_contacts]
  booking = mongo_service.find_booking_by_id(booking_id)
  if not booking:
    raise HTTPException(status_code=404, detail="booking not found")

  old_people = max(1, int(booking.get("numberOfPeople") or 1))
  new_people = old_people + len(additional_travelers)
  if new_people > 20:
    raise HTTPException(status_code=400, detail="Maximum 20 travelers per booking.")

  old_package = int(booking.get("packageTotalInr") or 0)
  old_advance = int(booking.get("advancePaymentInr") or 0)
  old_balance = int(booking.get("balanceDueInr") or 0)
  old_payment = str(booking.get("payment") or "unpaid")

  existing: List[str] = []
  if isinstance(booking.get("travelers"), list) and booking["travelers"]:
    existing = [str(x) for x in booking["travelers"]]
  else:
    if booking.get("fullName"):
      existing.append(str(booking["fullName"]))
    for i in range(2, 21):
      key = f"traveler{i}"
      if booking.get(key):
        existing.append(str(booking[key]))

  if not existing:
    raise HTTPException(status_code=400, detail="booking has no lead traveler on file")

  primary = existing[0]
  prior_extras = existing[1:]
  all_extras = prior_extras + additional_travelers
  prior_contacts = [c for c in (booking.get("travelerContacts") or []) if isinstance(c, dict)]
  tfields = _traveler_document_fields(primary, all_extras, prior_contacts + additional_contacts)

  updated = mongo_service.update_booking_members(
    booking_id,
    tfields,
    new_people,
    triggered_by,
    old_people,
  )
  if not updated:
    raise HTTPException(status_code=404, detail="booking not found")

  totals = mongo_service.recalculate_booking_totals(updated, new_people)
  payment_status = mongo_service._payment_status_after_member_update(booking, totals)
  _run_email_background(
    email_service.notify_booking_members_updated,
    updated,
    old_people=old_people,
    new_people=new_people,
    package_total_inr=totals["packageTotalInr"],
    advance_payment_inr=totals["advancePaymentInr"],
    balance_due_inr=totals["balanceDueInr"],
    added_names=additional_travelers,
    triggered_by=triggered_by,
    old_package_total_inr=old_package,
    old_advance_payment_inr=old_advance,
    old_balance_due_inr=old_balance,
    old_payment_status=old_payment,
  )

  return {
    "message": "travelers updated",
    "number_of_people": new_people,
    "payment": payment_status,
    **totals,
  }


# Interactive docs / OpenAPI schema list every route (incl. admin) — never expose them in production.
app = FastAPI(
  title="Wonder Baboon API",
  docs_url=None if IS_PRODUCTION else "/docs",
  redoc_url=None if IS_PRODUCTION else "/redoc",
  openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

_cors_kw: Dict[str, Any] = dict(
  allow_origins=CORS_ORIGINS,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)
if not IS_PRODUCTION:
  _cors_kw["allow_origin_regex"] = (
    r"^https?://"  # http:// or https://
    r"("
    r"192\.168\.\d{1,3}\.\d{1,3}|"  # 192.168.0.0/16
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"  # 10.0.0.0/8
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|"  # 172.16–31.x.x
    r"localhost|127\.0\.0\.1"
    r")"
    r"(:\d+)?$"  # optional port
  )



@app.middleware("http")
async def request_logger(request: Request, call_next):
  rid = re.sub(r"[^A-Za-z0-9_-]", "", request.headers.get("x-request-id") or "")[:32] or uuid.uuid4().hex[:12]
  request.state.request_id = rid
  # Reject oversized bodies early (uploads get a larger, route-specific ceiling).
  try:
    declared = int(request.headers.get("content-length") or 0)
  except ValueError:
    declared = 0
  limit = MAX_UPLOAD_BODY if "/itinerary" in request.url.path or request.url.path.endswith("/photos") else MAX_JSON_BODY
  if declared > limit:
    return JSONResponse(status_code=413, content={"detail": "request too large"})
  start = time.perf_counter()
  log_extra = {"request_id": rid}
  try:
    response = await call_next(request)
  except Exception:
    duration_ms = (time.perf_counter() - start) * 1000
    logger.exception(
      "%s %s -> 500 in %.1fms (client=%s)",
      request.method,
      request.url.path,
      duration_ms,
      request.client.host if request.client else "?",
      extra=log_extra,
    )
    return JSONResponse(status_code=500, content={"detail": "internal server error"})
  duration_ms = (time.perf_counter() - start) * 1000
  response.headers["X-Request-ID"] = rid
  for key, value in SECURITY_HEADERS.items():
    response.headers.setdefault(key, value)
  if request.url.path.startswith("/api/") and request.url.path not in ("/api/trips", "/api/travel-gallery") and not request.url.path.startswith("/api/media/"):
    response.headers["Cache-Control"] = "no-store"  # never cache account / admin / payment responses
  elif request.url.path.startswith("/api/media/blog/") and response.status_code == 200:
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"  # uuid file names never change
  logger.info(
    "%s %s -> %s in %.1fms (client=%s)",
    request.method,
    request.url.path,
    response.status_code,
    duration_ms,
    request.client.host if request.client else "?",
    extra=log_extra,
  )
  return response


@app.middleware("http")
async def auth_rate_limit_layer(request: Request, call_next):
  return await auth_rate_limit_middleware(request, call_next)


# Added last = outermost: even 413/429/500 answers built by the layers above carry CORS headers,
# so the browser shows the real error instead of a bare "Failed to fetch".
app.add_middleware(CORSMiddleware, **_cors_kw)

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
# Public, read-only photo files (no directory listing). Only validated images are ever written here.
app.mount("/api/media", StaticFiles(directory=str(UPLOAD_DIR)), name="media")


@app.exception_handler(RuntimeError)
async def mongo_runtime_error_handler(_: Request, exc: RuntimeError):
  logger.error("RuntimeError: %s", exc)
  return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.on_event("startup")
def startup_event() -> None:
  logger.info("Starting Wonder Baboon API (production=%s)", IS_PRODUCTION)
  if razorpay_enabled():
    razorpay_reset_client()
    logger.info("Razorpay enabled key_id=%s", RAZORPAY_KEY_ID[:16] + "…" if RAZORPAY_KEY_ID else "")
  try:
    mongo_service.connect()
    if mongo_service.is_connected():
      mongo_service.seed_defaults()
      blog_service.ensure_indexes()
      logger.info("Mongo connected & seeded")
    else:
      logger.warning("Mongo not connected at startup; API will return 503 for DB endpoints")
  except Exception:
    logger.exception("Mongo startup failed")
  start_trip_completion_worker()
  threading.Thread(target=_blog_sweep_loop, name="blog-image-sweep", daemon=True).start()


def _blog_sweep_loop() -> None:
  while True:
    time.sleep(6 * 3600)
    try:
      removed = blog_service.sweep_orphan_images()
      if removed:
        logger.info("blog image sweep removed %s orphan file(s)", removed)
    except Exception:
      logger.exception("blog image sweep failed")


@app.post("/api/admin/email/test-trip-completed")
def admin_test_trip_completed_email(payload: dict, _: dict = Depends(require_admin)):
  to = str(payload.get("to") or "").strip().lower()
  if not to or "@" not in to:
    raise HTTPException(status_code=400, detail="Provide a valid 'to' email address")
  ok, err = send_test_trip_completed_email(to)
  if not ok:
    raise HTTPException(status_code=500, detail=err or "could not send test email")
  return {"message": f"Trip-completed test email sent to {to}"}


@app.post("/api/admin/trip-completion/run")
def admin_run_trip_completion_emails(_: dict = Depends(require_admin)):
  """Manually trigger trip-completed emails (fully paid + past end date)."""
  if not mongo_service.is_connected():
    raise HTTPException(status_code=503, detail="database unavailable")
  sent = process_trip_completion_emails()
  return {"message": "trip completion check finished", "emails_sent": sent}


@app.get("/api/health")
def health():
  return {"ok": True}


@app.post("/api/auth/signup")
def signup(payload: UserSignupRequest):
  email = payload.email.lower().strip()
  if mongo_service.find_user_by_mobile(payload.mobile):
    raise HTTPException(status_code=409, detail="mobile already registered")
  user_doc = {
    "name": payload.name,
    "email": email,
    "mobile": payload.mobile,
    "password_hash": hash_password(payload.password),
    "role": "user",
    "createdAt": datetime.utcnow(),
  }
  try:
    mongo_service.create_user(user_doc)
  except ValueError:
    raise HTTPException(status_code=409, detail="user already exists")

  token = create_token({"role": "user", "email": email})
  logger.info("signup success email=%s", email)
  return {"token": token, "user": {"name": user_doc["name"], "email": email, "role": "user"}}


@app.post("/api/auth/login")
def login(payload: UnifiedLoginRequest, request: Request):
  identifier = payload.identifier.strip()
  # per (visitor, account): stops guessing without letting a stranger lock the real owner out
  lock_key = f"{client_ip(request)}|{identifier.lower()}"
  if _login_locked(lock_key):
    raise HTTPException(status_code=429, detail="too many failed attempts; try again in 15 minutes")
  if "@" in identifier:
    email = identifier.lower()
    user = mongo_service.find_user_by_email(email)
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
      _login_failed(lock_key)
      logger.info("login failed email=%s", email)
      raise HTTPException(status_code=401, detail="invalid credentials")
    _login_ok(lock_key)
    token = create_token({"role": "user", "email": user["email"]})
    logger.info("login success email=%s", email)
    return {"token": token, "user": {"role": "user", "email": user["email"], "name": user.get("name", "")}}

  username = sanitize_text(identifier, "username")
  admin = mongo_service.find_admin(username)
  if not admin:
    _login_failed(lock_key)
    logger.info("admin login failed username=%s", username)
    raise HTTPException(status_code=401, detail="invalid credentials")
  if admin.get("password_hash"):
    valid = verify_password(payload.password, admin["password_hash"])
  else:
    valid = hmac.compare_digest(payload.password, str(admin.get("password", "")))
  if not valid:
    _login_failed(lock_key)
    logger.info("admin login bad password username=%s", username)
    raise HTTPException(status_code=401, detail="invalid credentials")

  _login_ok(lock_key)
  token = create_token({"role": "admin", "username": username})
  logger.info("admin login success username=%s", username)
  return {"token": token, "user": {"role": "admin", "username": username}}


def _require_user(authorization: Optional[str]) -> dict:
  token_payload = decode_token(authorization)
  if not token_payload or token_payload.get("role") != "user":
    raise HTTPException(status_code=401, detail="user login required")
  return token_payload


@app.get("/api/trips")
def list_trips():
  mongo_service.ensure_ready()
  return {"trips": mongo_service.list_published_trips()}


@app.get("/api/payments/razorpay/config")
def razorpay_config():
  key = RAZORPAY_KEY_ID if razorpay_enabled() else ""
  return {
    "enabled": razorpay_enabled(),
    "key_id": key,
    "test_mode": key.startswith("rzp_test_"),
    "advance_percent": advance_percent(),
    "advance_refund_days": RAZORPAY_ADVANCE_REFUND_DAYS,
    "requires_payment_to_confirm": razorpay_enabled(),
  }


@app.post("/api/payments/razorpay/create-order")
def razorpay_create_order_endpoint(payload: RazorpayCreateOrderRequest):
  pending_token = (payload.pending_token or "").strip()
  bid = (payload.booking_id or "").strip()
  logger.info("create-order start booking_id=%s pending=%s kind=%s", bid or "—", bool(pending_token), payload.payment_kind)
  if not razorpay_enabled():
    logger.warning("create-order rejected: razorpay not configured")
    raise HTTPException(status_code=503, detail="online advance payment is not configured")

  if pending_token:
    doc = decode_pending_booking_token(pending_token)
    mongo_service.ensure_ready()
    package_total = mongo_service.package_total_inr_for_booking(doc, None)
    if package_total is None:
      logger.warning(
        "create-order pending no package total tripId=%s destination=%s",
        doc.get("tripId"),
        doc.get("travelDestination"),
      )
      raise HTTPException(
        status_code=400,
        detail="this trip has no catalogue price; online advance is not available",
      )
    advance_inr, balance_inr, amount_paise = _payment_amounts_for_kind(package_total, payload.payment_kind)
    receipt = f"pend_{hashlib.sha256(pending_token.encode()).hexdigest()[:20]}"
    logger.info(
      "create-order pending pricing kind=%s package_total_inr=%s pay_now_inr=%s amount_paise=%s people=%s",
      payload.payment_kind,
      package_total,
      advance_inr,
      amount_paise,
      doc.get("numberOfPeople"),
    )
    try:
      order = razorpay_create_order(
        amount_paise,
        receipt=receipt,
        notes={"flow": "pending_booking", "payment_kind": payload.payment_kind},
      )
    except RazorpayAuthError as error:
      logger.error("create-order RazorpayAuthError pending: %s", error)
      raise HTTPException(
        status_code=401,
        detail=_public_payment_error(
          error,
          "Online payment is temporarily unavailable. Please try again shortly or contact us.",
        ),
      ) from error
    except (RazorpayOrderError, ValueError) as error:
      logger.error("create-order order error pending: %s", error, exc_info=True)
      raise HTTPException(
        status_code=500,
        detail=_public_payment_error(error, "Could not create the payment order. Please try again."),
      ) from error
    order_id = str(order.get("id") or "").strip()
    if not order_id:
      logger.error("create-order missing order id pending response=%s", order)
      raise HTTPException(status_code=502, detail="could not create payment order")
    razorpay_amount = int(order.get("amount") or amount_paise)
    if razorpay_amount < MIN_AMOUNT_PAISE:
      raise HTTPException(status_code=502, detail="Razorpay returned an invalid order amount")
    logger.info(
      "create-order ok pending order_id=%s amount_paise=%s key_prefix=%s",
      order_id,
      razorpay_amount,
      (RAZORPAY_KEY_ID or "")[:16],
    )
    return {
      "order_id": order_id,
      "amount": razorpay_amount,
      "amount_paise": razorpay_amount,
      "currency": "INR",
      "key_id": RAZORPAY_KEY_ID,
      "package_total_inr": package_total,
      "advance_payment_inr": advance_inr,
      "balance_due_inr": balance_inr,
      "advance_percent": advance_percent() if payload.payment_kind == "advance" else 100,
      "payment_kind": payload.payment_kind,
    }

  mongo_service.ensure_ready()
  booking = mongo_service.find_booking_by_id(bid)
  if not booking:
    logger.warning("create-order booking not found id=%s", bid)
    raise HTTPException(status_code=404, detail="booking not found")
  payment_state = str(booking.get("payment") or "unpaid")
  if payment_state not in ("", "unpaid"):
    logger.warning(
      "create-order booking not unpaid id=%s payment=%s confirmed=%s",
      bid,
      payment_state,
      booking.get("confirmed"),
    )
    raise HTTPException(status_code=400, detail="this booking is not awaiting advance payment")
  package_total = mongo_service.package_total_inr_for_booking(booking, None)
  if package_total is None:
    logger.warning(
      "create-order no package total booking=%s tripId=%s destination=%s",
      bid,
      booking.get("tripId"),
      booking.get("travelDestination"),
    )
    raise HTTPException(
      status_code=400,
      detail="this trip has no catalogue price; online advance is not available",
    )
  advance_inr, balance_inr, amount_paise = _payment_amounts_for_kind(package_total, payload.payment_kind)
  logger.info(
    "create-order pricing booking=%s kind=%s package_total_inr=%s pay_now_inr=%s amount_paise=%s people=%s",
    bid,
    payload.payment_kind,
    package_total,
    advance_inr,
    amount_paise,
    booking.get("numberOfPeople"),
  )
  try:
    order = razorpay_create_order(
      amount_paise,
      receipt=payload.booking_id,
      notes={"booking_id": payload.booking_id, "payment_kind": payload.payment_kind},
    )
  except RazorpayAuthError as error:
    logger.error("create-order RazorpayAuthError booking=%s: %s", bid, error)
    raise HTTPException(
      status_code=401,
      detail=_public_payment_error(
        error,
        "Online payment is temporarily unavailable. Please try again shortly or contact us.",
      ),
    ) from error
  except (RazorpayOrderError, ValueError) as error:
    logger.error("create-order order error booking=%s: %s", bid, error, exc_info=True)
    raise HTTPException(
      status_code=500,
      detail=_public_payment_error(error, "Could not create the payment order. Please try again."),
    ) from error
  order_id = str(order.get("id") or "").strip()
  if not order_id:
    logger.error("create-order missing order id in Razorpay response booking=%s response=%s", bid, order)
    raise HTTPException(status_code=502, detail="could not create payment order")
  razorpay_amount = int(order.get("amount") or amount_paise)
  if razorpay_amount < MIN_AMOUNT_PAISE:
    logger.error(
      "create-order invalid razorpay amount booking=%s razorpay_amount=%s expected_paise=%s",
      bid,
      razorpay_amount,
      amount_paise,
    )
    raise HTTPException(status_code=502, detail="Razorpay returned an invalid order amount")
  if not mongo_service.set_booking_razorpay_order(
    bid,
    order_id,
    package_total,
    advance_inr,
    amount_paise,
    RAZORPAY_KEY_ID,
    payment_kind=payload.payment_kind,
  ):
    logger.error("create-order mongo attach failed booking=%s order=%s", bid, order_id)
    raise HTTPException(status_code=400, detail="could not attach payment order to booking")
  logger.info(
    "create-order ok booking=%s order_id=%s amount_paise=%s key_prefix=%s",
    bid,
    order_id,
    razorpay_amount,
    (RAZORPAY_KEY_ID or "")[:16],
  )
  return {
    "order_id": order_id,
    "amount": razorpay_amount,
    "amount_paise": razorpay_amount,
    "currency": "INR",
    "key_id": RAZORPAY_KEY_ID,
    "package_total_inr": package_total,
    "advance_payment_inr": advance_inr,
    "balance_due_inr": balance_inr,
    "advance_percent": advance_percent() if payload.payment_kind == "advance" else 100,
    "payment_kind": payload.payment_kind,
  }


# Standard Checkout aliases
@app.post("/api/create-order")
def api_create_order_alias(payload: RazorpayCreateOrderRequest):
  """Create Razorpay order for a pending booking (Wonder Baboon flow)."""
  return razorpay_create_order_endpoint(payload)


def _resolve_booking_for_razorpay_payment(
  booking_id: str,
  razorpay_order_id: str,
) -> tuple[dict, str]:
  """Match booking by id and/or Razorpay order id (handles retry / duplicate book clicks)."""
  order_id = (razorpay_order_id or "").strip()
  bid = (booking_id or "").strip()
  booking: Optional[dict] = None
  resolved_id = bid

  if bid:
    booking = mongo_service.find_booking_by_id(bid)
  if booking and order_id:
    stored = str(booking.get("razorpayOrderId") or "").strip()
    if stored and stored != order_id:
      alt = mongo_service.find_booking_by_razorpay_order_id(order_id)
      if alt:
        logger.info(
          "verify: matched booking by razorpay order %s (client booking_id %s had order %s)",
          order_id,
          bid,
          stored,
        )
        booking = alt
        resolved_id = str(alt.get("_id", ""))
      else:
        raise HTTPException(
          status_code=400,
          detail="payment order does not match this booking — please use Book & pay once and complete payment in the Razorpay window",
        )
  if not booking and order_id:
    booking = mongo_service.find_booking_by_razorpay_order_id(order_id)
    if booking:
      resolved_id = str(booking.get("_id", ""))
  if not booking:
    raise HTTPException(status_code=404, detail="booking not found")
  if not resolved_id:
    resolved_id = str(booking.get("_id", ""))
  return booking, resolved_id


@app.post("/api/payments/razorpay/verify")
def razorpay_verify_endpoint(payload: RazorpayVerifyRequest):
  order_id = payload.razorpay_order_id.strip()
  payment_id = payload.razorpay_payment_id.strip()
  pending_token = (payload.pending_token or "").strip()
  bid = (payload.booking_id or "").strip()
  logger.info(
    "verify-payment start client_booking=%s pending=%s order=%s payment=%s sig_len=%s",
    bid or "—",
    bool(pending_token),
    order_id,
    payment_id,
    len(payload.razorpay_signature or ""),
  )
  if not razorpay_enabled():
    logger.warning("verify-payment rejected: razorpay not configured")
    raise HTTPException(status_code=503, detail="online advance payment is not configured")

  if pending_token:
    if not verify_payment_signature(
      order_id,
      payload.razorpay_payment_id,
      payload.razorpay_signature,
    ):
      logger.warning(
        "razorpay signature verify failed pending order=%s payment=%s",
        order_id,
        payload.razorpay_payment_id,
      )
      raise HTTPException(
        status_code=400,
        detail="payment verification failed — contact Wonder Baboon with your payment reference",
      )
    doc = decode_pending_booking_token(pending_token)
    mongo_service.ensure_ready()
    package_total = mongo_service.package_total_inr_for_booking(doc, None)
    if package_total is None:
      raise HTTPException(status_code=400, detail="could not determine package total")
    advance_inr, _balance_inr, amount_paise = _payment_amounts_for_kind(package_total, payload.payment_kind)
    doc["confirmed"] = False
    doc["requiresOnlineAdvance"] = True
    doc["razorpayOrderId"] = order_id
    doc["razorpayKeyId"] = (RAZORPAY_KEY_ID or "").strip()
    doc["razorpayPackageTotalInr"] = int(package_total)
    doc["razorpayAdvanceInr"] = int(advance_inr)
    doc["razorpayAmountPaise"] = int(amount_paise)
    doc["razorpayPaymentKind"] = payload.payment_kind
    doc["razorpayPaymentId"] = payment_id
    booking_id = mongo_service.insert_booking(doc)
    mongo_service.set_booking_razorpay_payment_refs(booking_id, payment_id)
    result = _admin_confirm_booking_payment(booking_id, advance_inr, None)
    result["booking_id"] = booking_id
    logger.info(
      "verify-payment ok pending saved booking=%s order=%s payment=%s payment_status=%s",
      booking_id,
      order_id,
      payment_id,
      result.get("payment"),
    )
    return result

  mongo_service.ensure_ready()
  try:
    booking, booking_id = _resolve_booking_for_razorpay_payment(bid, order_id)
  except HTTPException as exc:
    logger.warning(
      "verify-payment resolve failed client_booking=%s order=%s status=%s detail=%s",
      bid,
      order_id,
      exc.status_code,
      exc.detail,
    )
    raise
  if booking.get("payment") == "advance_paid":
    logger.info("verify-payment already advance_paid booking=%s", booking_id)
    return {
      "message": "advance payment already recorded",
      "payment": "advance_paid",
      "package_total_inr": int(booking.get("packageTotalInr") or 0),
      "advance_payment_inr": int(booking.get("advancePaymentInr") or 0),
      "balance_due_inr": int(booking.get("balanceDueInr") or 0),
    }
  if booking.get("payment") == "paid":
    raise HTTPException(status_code=400, detail="this booking is already fully paid")
  stored_order = str(booking.get("razorpayOrderId") or "").strip()
  if stored_order and stored_order != order_id:
    logger.warning(
      "verify-payment order mismatch booking=%s stored=%s paid=%s",
      booking_id,
      stored_order,
      order_id,
    )
    raise HTTPException(status_code=400, detail="payment order does not match this booking")
  if not verify_payment_signature(
    order_id,
    payload.razorpay_payment_id,
    payload.razorpay_signature,
  ):
    logger.warning(
      "razorpay signature verify failed booking=%s order=%s payment=%s",
      booking_id,
      order_id,
      payload.razorpay_payment_id,
    )
    raise HTTPException(
      status_code=400,
      detail="payment verification failed — contact Wonder Baboon with your payment reference",
    )
  advance_inr = int(booking.get("razorpayAdvanceInr") or 0)
  payment_kind = str(booking.get("razorpayPaymentKind") or payload.payment_kind or "advance")
  if advance_inr < 1:
    package_total = mongo_service.package_total_inr_for_booking(booking, None)
    if package_total is None:
      raise HTTPException(status_code=400, detail="could not determine package total")
    advance_inr, _, _ = _payment_amounts_for_kind(package_total, payment_kind)
  mongo_service.set_booking_razorpay_payment_refs(booking_id, payment_id)
  result = _admin_confirm_booking_payment(booking_id, advance_inr, None)
  logger.info(
    "verify-payment ok booking=%s order=%s payment=%s payment_status=%s",
    booking_id,
    order_id,
    payment_id,
    result.get("payment"),
  )
  return result


@app.post("/api/verify-payment")
def api_verify_payment_alias(payload: RazorpayVerifyRequest):
  """Verify Standard Checkout signature and confirm booking advance."""
  result = razorpay_verify_endpoint(payload)
  return {"success": True, **result}


@app.post("/api/bookings/guest")
def guest_booking(payload: GuestBookingRequest):
  tfields = _traveler_document_fields(
    payload.full_name,
    payload.additional_travelers,
    [c.model_dump() for c in payload.additional_contacts],
  )
  trip = mongo_service.find_trip_by_id(payload.trip_id)
  doc = {
    "tripType": "defined_trip",
    "tripId": payload.trip_id,
    "travelDestination": payload.travel_destination,
    "dateOfTravel": _locked_travel_date(trip, payload.date_of_travel),
    "fullName": payload.full_name,
    "mobile": payload.mobile,
    "email": payload.email,
    "numberOfPeople": payload.number_of_people,
    "payment": "unpaid",
    "source": "guest_booking",
    "createdAt": datetime.utcnow(),
    **tfields,
  }
  logger.info("guest booking trip=%s email=%s", payload.travel_destination, payload.email)
  return _save_catalogue_booking(doc)


@app.post("/api/bookings/user")
def user_booking(payload: dict, authorization: Optional[str] = Header(default=None)):
  token_payload = _require_user(authorization)

  trip_id = sanitize_text(str(payload.get("trip_id", "")), "trip_id")
  trip = mongo_service.find_trip_by_id(trip_id)
  if not trip:
    raise HTTPException(status_code=404, detail="trip not found")

  user = mongo_service.find_user_by_email(token_payload.get("email", ""))
  if not user:
    raise HTTPException(status_code=404, detail="user not found")

  date_of_travel = _locked_travel_date(trip, str(payload.get("date_of_travel") or "").strip())
  if not date_of_travel:
    raise HTTPException(status_code=400, detail="date of travel is required")
  try:
    trip_date = datetime.strptime(date_of_travel, "%Y-%m-%d").date()
  except ValueError:
    raise HTTPException(status_code=400, detail="invalid date format (expected YYYY-MM-DD)")
  if trip_date < datetime.now().date():
    raise HTTPException(status_code=400, detail="date of travel cannot be in the past")

  try:
    people = int(payload.get("number_of_people", 1) or 1)
  except (TypeError, ValueError):
    raise HTTPException(status_code=400, detail="number of people must be a number")
  if people < 1 or people > 20:
    raise HTTPException(status_code=400, detail="number of people must be between 1 and 20")

  raw_contacts = payload.get("additional_contacts") or []
  if not isinstance(raw_contacts, list):
    raw_contacts = []
  need = people - 1
  try:
    contacts = [TravelerContact(**c).model_dump() for c in raw_contacts[:19] if isinstance(c, dict)]
  except ValidationError as exc:
    first = exc.errors()[0]
    where = ".".join(str(x) for x in first.get("loc", ()))
    raise HTTPException(status_code=400, detail=f"Traveler details invalid ({where}): {first.get('msg', 'invalid')}")
  if len(contacts) != need:
    raise HTTPException(
      status_code=400,
      detail=f"Provide name, mobile and email for each of the {need} additional traveler(s).",
    )
  extras = [c["name"] for c in contacts]
  lead_name = str(user.get("name") or "").strip()
  if people > 1 and len(lead_name) < 2:
    raise HTTPException(
      status_code=400,
      detail="Add your full name in Settings before booking for more than one person.",
    )
  tfields = _traveler_document_fields(lead_name or "Traveler", extras, contacts)

  doc = {
    "tripType": "defined_trip",
    "tripId": trip_id,
    "travelDestination": trip.get("title"),
    "dateOfTravel": date_of_travel,
    "fullName": user.get("name", ""),
    "mobile": user.get("mobile", ""),
    "email": user.get("email", ""),
    "numberOfPeople": people,
    "payment": "unpaid",
    "source": "logged_in_direct_booking",
    "createdAt": datetime.utcnow(),
    **tfields,
  }
  logger.info(
    "user booking trip=%s email=%s date=%s people=%s",
    trip.get("title"),
    user.get("email"),
    date_of_travel,
    people,
  )
  return _save_catalogue_booking(doc)


@app.get("/api/user/profile")
def get_user_profile(authorization: Optional[str] = Header(default=None)):
  token_payload = _require_user(authorization)
  user = mongo_service.find_user_by_email(token_payload.get("email", ""))
  if not user:
    raise HTTPException(status_code=404, detail="user not found")
  return {
    "name": user.get("name", ""),
    "email": user.get("email", ""),
    "mobile": user.get("mobile", ""),
  }


@app.patch("/api/user/profile")
def patch_user_profile(
  payload: ProfileNameUpdateRequest,
  authorization: Optional[str] = Header(default=None),
):
  token_payload = _require_user(authorization)
  email = token_payload.get("email", "")
  ok = mongo_service.update_user_name(email, payload.name)
  if not ok:
    raise HTTPException(status_code=404, detail="user not found")
  return {"message": "profile updated", "name": payload.name}


@app.get("/api/user/bookings")
def get_user_bookings(authorization: Optional[str] = Header(default=None)):
  token_payload = _require_user(authorization)
  email = token_payload.get("email", "")
  user = mongo_service.find_user_by_email(email)
  mobile = (user.get("mobile") if user else None) or None
  return {"bookings": mongo_service.list_user_bookings(email, mobile)}


@app.patch("/api/user/bookings/{booking_id}/members")
def user_add_booking_members(
  booking_id: str,
  payload: AddMembersRequest,
  authorization: Optional[str] = Header(default=None),
):
  token_payload = _require_user(authorization)
  email = token_payload.get("email", "")
  user = mongo_service.find_user_by_email(email)
  if not user:
    raise HTTPException(status_code=404, detail="user not found")

  booking = mongo_service.find_booking_by_id(booking_id)
  if not booking:
    raise HTTPException(status_code=404, detail="booking not found")
  if not _booking_belongs_to_user(booking, email, user.get("mobile")):
    raise HTTPException(status_code=403, detail="not your booking")
  if booking.get("payment") == "paid":
    raise HTTPException(
      status_code=400,
      detail="This booking is fully paid. Contact Wonder Baboon to add more travelers.",
    )

  return _apply_booking_member_update(booking_id, [c.model_dump() for c in payload.additional_contacts], "user")


@app.post("/api/user/profile/email-otp/request")
def request_email_otp(payload: EmailOtpRequest, authorization: Optional[str] = Header(default=None)):
  token_payload = _require_user(authorization)
  current_email = token_payload.get("email", "")
  new_email = payload.new_email.lower().strip()
  if new_email == current_email:
    raise HTTPException(status_code=400, detail="new email is same as current")
  if mongo_service.find_user_by_email(new_email):
    raise HTTPException(status_code=409, detail="email already in use")
  ok, message = otp_service.request(current_email, "email", new_email)
  if not ok:
    raise HTTPException(status_code=429 if "wait" in message else 500, detail=message)
  return {"message": message}


@app.post("/api/user/profile/email-otp/verify")
def verify_email_otp(payload: OtpVerifyRequest, authorization: Optional[str] = Header(default=None)):
  token_payload = _require_user(authorization)
  current_email = token_payload.get("email", "")
  new_email = otp_service.verify(current_email, "email", payload.code)
  if not new_email:
    raise HTTPException(status_code=400, detail="invalid or expired code")
  try:
    ok = mongo_service.update_user_email(current_email, new_email)
  except ValueError as exc:
    raise HTTPException(status_code=409, detail=str(exc))
  if not ok:
    raise HTTPException(status_code=404, detail="user not found")
  user = mongo_service.find_user_by_email(new_email)
  token = create_token({"role": "user", "email": new_email})
  return {
    "message": "email updated",
    "token": token,
    "user": {"role": "user", "email": new_email, "name": (user or {}).get("name", "")},
  }


@app.post("/api/user/profile/mobile-otp/request")
def request_mobile_otp(payload: MobileOtpRequest, authorization: Optional[str] = Header(default=None)):
  token_payload = _require_user(authorization)
  current_email = token_payload.get("email", "")
  if mongo_service.find_user_by_mobile(payload.new_mobile):
    raise HTTPException(status_code=409, detail="mobile already in use")
  ok, message = otp_service.request(current_email, "mobile", payload.new_mobile)
  if not ok:
    raise HTTPException(status_code=429 if "wait" in message else 500, detail=message)
  return {"message": message}


@app.post("/api/user/profile/mobile-otp/verify")
def verify_mobile_otp(payload: OtpVerifyRequest, authorization: Optional[str] = Header(default=None)):
  token_payload = _require_user(authorization)
  current_email = token_payload.get("email", "")
  new_mobile = otp_service.verify(current_email, "mobile", payload.code)
  if not new_mobile:
    raise HTTPException(status_code=400, detail="invalid or expired code")
  try:
    ok = mongo_service.update_user_mobile(current_email, new_mobile)
  except ValueError as exc:
    raise HTTPException(status_code=409, detail=str(exc))
  if not ok:
    raise HTTPException(status_code=404, detail="user not found")
  return {"message": "mobile updated", "mobile": new_mobile}


@app.post("/api/planned-trips")
def planned_trip(payload: PlannedTripRequest):
  tfields = _traveler_document_fields(payload.full_name, payload.additional_travelers)
  doc = {
    "tripType": "planned_trip",
    "travelDestination": payload.travel_destination,
    "dateOfTravel": payload.date_of_travel,
    "fullName": payload.full_name,
    "mobile": payload.mobile,
    "email": payload.email,
    "numberOfPeople": payload.number_of_people,
    "payment": "unpaid",
    "source": "planned_trip_form",
    "createdAt": datetime.utcnow(),
    **tfields,
  }
  mongo_service.insert_booking(doc)
  _notify_booking_created(doc)
  logger.info("planned trip dest=%s email=%s", payload.travel_destination, payload.email)
  return {"message": "planned trip saved"}


@app.get("/api/admin/stats")
def admin_stats(_: dict = Depends(require_admin)):
  return mongo_service.get_admin_stats()


@app.get("/api/admin/bookings")
def admin_bookings(search: str = "", _: dict = Depends(require_admin)):
  return {"bookings": mongo_service.search_bookings(search)}


@app.patch("/api/admin/bookings/{booking_id}/confirm")
def admin_confirm_booking(booking_id: str, payload: AdminConfirmPaymentFields, _: dict = Depends(require_admin)):
  return _admin_confirm_booking_payment(
    booking_id,
    payload.advance_payment_inr,
    payload.trip_total_inr,
  )


@app.post("/api/admin/bookings/confirm-payment")
def admin_confirm_booking_post(payload: AdminConfirmBookingRequest, _: dict = Depends(require_admin)):
  return _admin_confirm_booking_payment(
    payload.booking_id,
    payload.advance_payment_inr,
    payload.trip_total_inr,
  )


@app.post("/api/admin/bookings/mark-full-payment")
def admin_mark_full_payment(payload: AdminMarkFullPaymentRequest, _: dict = Depends(require_admin)):
  return _admin_mark_booking_fully_paid(payload.booking_id)


@app.delete("/api/admin/bookings/{booking_id}")
def admin_delete_booking(booking_id: str, _: dict = Depends(require_admin)):
  if not mongo_service.delete_booking(booking_id):
    raise HTTPException(status_code=404, detail="booking not found")
  return {"message": "booking deleted"}


@app.patch("/api/admin/bookings/{booking_id}/members")
def admin_add_booking_members(
  booking_id: str,
  payload: AddMembersRequest,
  _: dict = Depends(require_admin),
):
  return _apply_booking_member_update(booking_id, [c.model_dump() for c in payload.additional_contacts], "admin")


@app.get("/api/admin/trips")
def admin_trips(search: str = "", _: dict = Depends(require_admin)):
  return {"trips": mongo_service.search_trips(search)}


@app.post("/api/admin/trips")
def admin_add_trip(payload: AdminTripCreateRequest, _: dict = Depends(require_admin)):
  trip_id = mongo_service.add_trip(payload.model_dump())
  return {"message": "trip detail added", "trip_id": trip_id}


@app.patch("/api/admin/trips/{trip_id}")
def admin_update_trip(
  trip_id: str,
  payload: AdminTripUpdateRequest,
  _: dict = Depends(require_admin),
):
  try:
    ok = mongo_service.update_trip(trip_id, payload.model_dump(exclude_unset=True))
  except ValueError as exc:
    raise HTTPException(status_code=409, detail=str(exc)) from exc
  if not ok:
    raise HTTPException(status_code=404, detail="trip not found")
  return {"message": "trip updated"}


@app.delete("/api/admin/trips/{trip_id}")
def admin_delete_trip(trip_id: str, _: dict = Depends(require_admin)):
  if not mongo_service.delete_trip(trip_id):
    raise HTTPException(status_code=404, detail="trip not found")
  return {"message": "trip deleted"}


@app.post("/api/admin/trips/{trip_id}/itinerary")
async def admin_upload_trip_itinerary(
  trip_id: str,
  file: UploadFile = File(...),
  _: dict = Depends(require_admin),
):
  filename = (file.filename or "").strip()
  if not filename.lower().endswith(".pdf"):
    raise HTTPException(status_code=400, detail="Upload a PDF file (.pdf)")
  data = await file.read()
  if len(data) > 5 * 1024 * 1024:
    raise HTTPException(status_code=400, detail="PDF must be 5MB or smaller")
  if not data.startswith(b"%PDF-"):
    raise HTTPException(status_code=400, detail="That file is not a valid PDF")
  try:
    html_fragment = pdf_bytes_to_itinerary_html(data)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc
  if not mongo_service.set_trip_itinerary_html(trip_id, html_fragment):
    raise HTTPException(status_code=404, detail="trip not found")
  return {"message": "itinerary saved from PDF"}


@app.delete("/api/admin/trips/{trip_id}/itinerary")
def admin_clear_trip_itinerary(trip_id: str, _: dict = Depends(require_admin)):
  if not mongo_service.set_trip_itinerary_html(trip_id, None):
    raise HTTPException(status_code=404, detail="trip not found")
  return {"message": "custom itinerary removed"}


GALLERY_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "gif"}


def _looks_like_image(data: bytes, ext: str) -> bool:
  """Check the file's magic bytes, so a renamed script/HTML/SVG can't be stored as a photo."""
  if ext in {"jpg", "jpeg"}:
    return data[:3] == b"\xff\xd8\xff"
  if ext == "png":
    return data[:8] == b"\x89PNG\r\n\x1a\n"
  if ext == "gif":
    return data[:6] in (b"GIF87a", b"GIF89a")
  if ext == "webp":
    return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
  return False


def _gallery_fields(payload) -> Dict[str, Any]:
  return payload.model_dump(exclude_unset=True)


@app.get("/api/travel-gallery")
def public_travel_gallery():
  return {"destinations": mongo_service.list_travel_gallery()}


@app.get("/api/admin/travel-gallery")
def admin_travel_gallery(_: dict = Depends(require_admin)):
  return {"destinations": mongo_service.list_travel_gallery()}


@app.get("/api/admin/travel-gallery/{state_id}")
def admin_travel_gallery_one(state_id: str, _: dict = Depends(require_admin)):
  dest = mongo_service.find_travel_gallery_by_id(state_id)
  if not dest:
    raise HTTPException(status_code=404, detail="state not found")
  return {"destination": dest}


@app.post("/api/admin/travel-gallery")
def admin_create_gallery_state(payload: TravelGalleryStateRequest, _: dict = Depends(require_admin)):
  if not payload.state:
    raise HTTPException(status_code=400, detail="state name is required")
  created = mongo_service.create_gallery_state(_gallery_fields(payload))
  if not created:
    raise HTTPException(status_code=409, detail="that state already exists")
  return {"message": "state added", "destination": created}


@app.put("/api/admin/travel-gallery/{state_id}")
def admin_update_gallery_state(state_id: str, payload: TravelGalleryStateRequest, _: dict = Depends(require_admin)):
  if not mongo_service.update_gallery_state(state_id, _gallery_fields(payload)):
    raise HTTPException(status_code=404, detail="state not found")
  return {"message": "state updated", "destination": mongo_service.find_travel_gallery_by_id(state_id)}


@app.post("/api/admin/travel-gallery/{state_id}/places")
def admin_add_gallery_place(state_id: str, payload: TravelGalleryPlaceRequest, _: dict = Depends(require_admin)):
  if not payload.name:
    raise HTTPException(status_code=400, detail="place name is required")
  place = mongo_service.add_gallery_place(state_id, _gallery_fields(payload))
  if not place:
    raise HTTPException(status_code=404, detail="state not found")
  return {"message": "place added", "place": place, "destination": mongo_service.find_travel_gallery_by_id(state_id)}


@app.put("/api/admin/travel-gallery/{state_id}/places/{place_id}")
def admin_update_gallery_place(
  state_id: str, place_id: str, payload: TravelGalleryPlaceRequest, _: dict = Depends(require_admin)
):
  if not mongo_service.update_gallery_place(state_id, place_id, _gallery_fields(payload)):
    raise HTTPException(status_code=404, detail="place not found")
  return {"message": "place updated", "destination": mongo_service.find_travel_gallery_by_id(state_id)}


@app.delete("/api/admin/travel-gallery/{state_id}/places/{place_id}")
def admin_delete_gallery_place(state_id: str, place_id: str, _: dict = Depends(require_admin)):
  if not mongo_service.delete_gallery_place(state_id, place_id):
    raise HTTPException(status_code=404, detail="place not found")
  return {"message": "place deleted", "destination": mongo_service.find_travel_gallery_by_id(state_id)}


@app.post("/api/admin/travel-gallery/{state_id}/places/{place_id}/visits")
def admin_add_gallery_visit(
  state_id: str, place_id: str, payload: TravelGalleryVisitRequest, _: dict = Depends(require_admin)
):
  visit = mongo_service.add_gallery_visit(state_id, place_id, _gallery_fields(payload))
  if not visit:
    raise HTTPException(status_code=404, detail="place not found")
  return {"message": "visit added", "visit": visit, "destination": mongo_service.find_travel_gallery_by_id(state_id)}


@app.put("/api/admin/travel-gallery/{state_id}/places/{place_id}/visits/{visit_id}")
def admin_update_gallery_visit(
  state_id: str, place_id: str, visit_id: str, payload: TravelGalleryVisitRequest, _: dict = Depends(require_admin)
):
  if not mongo_service.update_gallery_visit(state_id, place_id, visit_id, _gallery_fields(payload)):
    raise HTTPException(status_code=404, detail="visit not found")
  return {"message": "visit updated", "destination": mongo_service.find_travel_gallery_by_id(state_id)}


@app.delete("/api/admin/travel-gallery/{state_id}/places/{place_id}/visits/{visit_id}")
def admin_delete_gallery_visit(state_id: str, place_id: str, visit_id: str, _: dict = Depends(require_admin)):
  if not mongo_service.delete_gallery_visit(state_id, place_id, visit_id):
    raise HTTPException(status_code=404, detail="visit not found")
  return {"message": "visit deleted", "destination": mongo_service.find_travel_gallery_by_id(state_id)}


@app.post("/api/admin/travel-gallery/{state_id}/places/{place_id}/visits/{visit_id}/photos")
async def admin_upload_gallery_visit_photos(
  state_id: str,
  place_id: str,
  visit_id: str,
  request: Request,
  files: List[UploadFile] = File(...),
  _: dict = Depends(require_admin),
):
  """Upload one or many photos straight into a visit (they are saved to the visit immediately)."""
  dest = mongo_service.find_travel_gallery_by_id(state_id)
  place = next((p for p in (dest or {}).get("places", []) if p.get("id") == place_id), None)
  if not place or not any(v.get("id") == visit_id for v in place.get("visits", [])):
    raise HTTPException(status_code=404, detail="visit not found")
  if len(files) > 30:
    raise HTTPException(status_code=400, detail="Upload up to 30 photos at a time")

  safe_state = re.sub(r"[^a-z0-9-]", "", state_id.strip().lower())
  safe_place = re.sub(r"[^a-z0-9-]", "", place_id.strip().lower())
  origin = MEDIA_PUBLIC_ORIGIN or str(request.base_url).rstrip("/")
  if IS_PRODUCTION and origin.startswith("http://"):
    origin = "https://" + origin[len("http://"):]
  folder = UPLOAD_DIR / "gallery" / safe_state / safe_place
  saved: List[str] = []
  for file in files:
    original = (file.filename or "").strip()
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    if ext not in GALLERY_IMAGE_EXTS:
      raise HTTPException(status_code=400, detail=f"{original or 'file'}: upload JPG, PNG, WEBP or GIF")
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
      raise HTTPException(status_code=400, detail=f"{original}: image must be 8MB or smaller")
    if not _looks_like_image(data, ext):
      raise HTTPException(status_code=400, detail=f"{original}: file is not a valid {ext.upper()} image")
    stem = re.sub(r"[^a-zA-Z0-9_-]", "_", original.rsplit(".", 1)[0])[:48] or "photo"
    filename = f"{stem}-{uuid.uuid4().hex[:8]}.{ext}"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / filename).write_bytes(data)
    saved.append(f"{origin}/api/media/gallery/{safe_state}/{safe_place}/{filename}")

  if not mongo_service.append_gallery_visit_photos(state_id, place_id, visit_id, saved):
    raise HTTPException(status_code=404, detail="visit not found")
  return {
    "message": f"{len(saved)} photo(s) uploaded",
    "paths": saved,
    "destination": mongo_service.find_travel_gallery_by_id(state_id),
  }


# ----- The Quibbler (travel stories) -----


def _viewer_email(authorization: Optional[str]) -> str:
  payload = decode_token(authorization)
  if payload and payload.get("role") == "user":
    return str(payload.get("email") or "")
  return ""


def _is_admin_token(authorization: Optional[str]) -> bool:
  payload = decode_token(authorization)
  return bool(payload and payload.get("role") == "admin")


def _user_email(authorization: Optional[str]) -> str:
  email = str(_require_user(authorization).get("email") or "")
  if not email or not mongo_service.find_user_by_email(email):
    raise HTTPException(status_code=401, detail="user login required")
  return email


def _media_origin(request: Request) -> str:
  origin = MEDIA_PUBLIC_ORIGIN or str(request.base_url).rstrip("/")
  if IS_PRODUCTION and origin.startswith("http://"):
    origin = "https://" + origin[len("http://"):]
  return origin


@app.get("/api/blog")
def blog_list(
  mood: str = "All",
  sort: str = "latest",
  cursor: str = "",
  limit: int = 12,
  saved: bool = False,
  mine: bool = False,
  authorization: Optional[str] = Header(default=None),
):
  mongo_service.ensure_ready()
  viewer = _viewer_email(authorization)
  if saved and not viewer:
    raise HTTPException(status_code=401, detail="user login required")
  if mine and not viewer:
    raise HTTPException(status_code=401, detail="user login required")
  return blog_service.list_posts(mood, sort, cursor, limit, viewer, saved_only=saved, mine_only=mine)


@app.post("/api/blog/photos")
async def blog_upload_photos(
  request: Request,
  files: List[UploadFile] = File(...),
  authorization: Optional[str] = Header(default=None),
):
  mongo_service.ensure_ready()
  email = _user_email(authorization)
  if len(files) > 6:
    raise HTTPException(status_code=400, detail="Upload up to 6 photos at a time")
  origin = _media_origin(request)
  images = []
  for file in files:
    blog_service.check_rate("photo", email)
    data = await file.read()
    try:
      image = image_service.process_and_store(data, origin)
    except image_service.ImageRejected as error:
      raise HTTPException(status_code=400, detail=f"{file.filename or 'photo'}: {error}")
    blog_service.record_upload(email, image)
    images.append(image)
  return {"images": images}


@app.delete("/api/blog/photos")
def blog_discard_photo(payload: BlogDiscardUploadRequest, authorization: Optional[str] = Header(default=None)):
  """The author removed a just-uploaded photo before publishing — delete it from disk right away
  instead of waiting on the 24h orphan sweep."""
  mongo_service.ensure_ready()
  email = _user_email(authorization)
  blog_service.discard_upload(email, payload.full, payload.thumb)
  return {"message": "discarded"}


def _notify_story_subscribers(followers: List[str], author_name: str, post: Dict[str, Any]) -> None:
  """Runs off the request thread — a slow/failed email must never block publishing."""
  story_url = f"{FRONTEND_PUBLIC_ORIGIN}/the-quibbler?story={post['id']}"
  for subscriber in followers:
    try:
      email_service.notify_new_story_subscriber(
        subscriber,
        author_name=author_name,
        story_title=post.get("title", ""),
        story_excerpt=post.get("excerpt", ""),
        mood=post.get("mood", ""),
        story_url=story_url,
      )
    except Exception:
      logger.exception("Failed to notify subscriber %s of new story", subscriber)


@app.post("/api/blog")
def blog_create(payload: BlogPostRequest, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  email = _user_email(authorization)
  post = blog_service.create_post(email, payload)
  followers = blog_service.list_followers(email)
  if followers:
    _run_email_background(_notify_story_subscribers, followers, post.get("authorName", ""), post)
  return {"post": post}


@app.post("/api/blog/{post_id}/follow")
def blog_follow_author(post_id: str, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  return blog_service.toggle_follow_author(post_id, _user_email(authorization))


@app.get("/api/blog/{post_id}")
def blog_get(post_id: str, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  return {"post": blog_service.get_post(post_id, _viewer_email(authorization), _is_admin_token(authorization))}


@app.delete("/api/blog/comments/{comment_id}")
def blog_delete_comment(comment_id: str, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  admin = _is_admin_token(authorization)
  email = "" if admin else _user_email(authorization)
  return blog_service.delete_comment(comment_id, email, admin)


@app.post("/api/blog/comments/{comment_id}/report")
def blog_report_comment(comment_id: str, payload: BlogReportRequest, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  return blog_service.report("comment", comment_id, _user_email(authorization), payload.reason)


@app.delete("/api/blog/{post_id}")
def blog_delete(post_id: str, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  admin = _is_admin_token(authorization)
  email = "" if admin else _user_email(authorization)
  blog_service.delete_post(post_id, email, admin)
  return {"message": "story deleted"}


@app.patch("/api/blog/{post_id}")
def blog_update(post_id: str, payload: BlogPostRequest, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  email = _user_email(authorization)
  return {"post": blog_service.update_post(post_id, email, payload)}


@app.post("/api/blog/{post_id}/like")
def blog_like(post_id: str, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  return blog_service.toggle_like(post_id, _user_email(authorization))


@app.post("/api/blog/{post_id}/save")
def blog_save(post_id: str, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  return blog_service.toggle_save(post_id, _user_email(authorization))


@app.get("/api/blog/{post_id}/comments")
def blog_comments(
  post_id: str,
  parentId: str = "",
  cursor: str = "",
  limit: int = 10,
  authorization: Optional[str] = Header(default=None),
):
  mongo_service.ensure_ready()
  return blog_service.list_comments(
    post_id, parentId, cursor, limit, _viewer_email(authorization), _is_admin_token(authorization)
  )


@app.post("/api/blog/{post_id}/comments")
def blog_add_comment(post_id: str, payload: BlogCommentRequest, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  return {"comment": blog_service.add_comment(post_id, _user_email(authorization), payload)}


@app.post("/api/blog/{post_id}/report")
def blog_report(post_id: str, payload: BlogReportRequest, authorization: Optional[str] = Header(default=None)):
  mongo_service.ensure_ready()
  return blog_service.report("post", post_id, _user_email(authorization), payload.reason)


@app.get("/api/admin/blog")
def admin_blog_list(status: str = "reported", _: dict = Depends(require_admin)):
  mongo_service.ensure_ready()
  return blog_service.admin_list(status)


@app.patch("/api/admin/blog/{post_id}")
def admin_blog_moderate(post_id: str, payload: BlogModerateRequest, _: dict = Depends(require_admin)):
  mongo_service.ensure_ready()
  if payload.status == "deleted":
    blog_service.delete_post(post_id, "", True)
    return {"id": post_id, "status": "deleted"}
  return blog_service.admin_set_status(post_id, payload.status)


if __name__ == "__main__":
  import uvicorn

  uvicorn.run(app, host=HOST, port=PORT)
