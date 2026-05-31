import hmac
import logging
import threading
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from auth_utils import create_token, decode_token, hash_password, require_admin, sanitize_text, verify_password
from config import (
  CORS_ORIGINS,
  HOST,
  IS_PRODUCTION,
  JWT_SECRET,
  PORT,
  RAZORPAY_ADVANCE_REFUND_DAYS,
  RAZORPAY_KEY_ID,
)
from logging_setup import configure_logging
from models import (
  AddMembersRequest,
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
  UnifiedLoginRequest,
  UserSignupRequest,
)
from middleware.auth_rate_limit import auth_rate_limit_middleware
from services.email_service import email_service
from services.itinerary_pdf import pdf_bytes_to_itinerary_html
from services.mongo_service import mongo_service
from services.otp_service import otp_service
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


def _inr_label(amount: int) -> str:
  try:
    n = int(amount)
  except (TypeError, ValueError):
    return "₹—"
  return f"₹{n:,}"


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


def _traveler_document_fields(primary_name: str, additional: List[str]) -> Dict[str, Any]:
  """Ordered travelers + traveler1..travelerN for storage and emails."""
  primary = sanitize_text(str(primary_name).strip(), "full_name")
  names: List[str] = [primary]
  for extra in additional:
    names.append(sanitize_text(str(extra).strip(), "full_name"))
  out: Dict[str, Any] = {"travelers": names}
  for i, nm in enumerate(names, start=1):
    if i <= 20:
      out[f"traveler{i}"] = nm
  return out


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


def _save_catalogue_booking(doc: Dict[str, Any]) -> str:
  """Persist catalogue booking; emails depend on whether online advance is required."""
  if razorpay_enabled():
    doc["confirmed"] = False
    doc["requiresOnlineAdvance"] = True
  booking_id = mongo_service.insert_booking(doc)
  if razorpay_enabled():
    _run_email_background(_notify_admin_booking_attempt, doc)
  else:
    _notify_booking_created(doc)
  return booking_id


def _booking_response(booking_id: str) -> Dict[str, Any]:
  out: Dict[str, Any] = {"message": "booking saved", "booking_id": booking_id}
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
  additional_travelers: List[str],
  triggered_by: str,
) -> Dict[str, Any]:
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
  tfields = _traveler_document_fields(primary, all_extras)

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


app = FastAPI(title="Wonder Baboon API")

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

app.add_middleware(CORSMiddleware, **_cors_kw)


@app.middleware("http")
async def request_logger(request: Request, call_next):
  rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
  request.state.request_id = rid
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
      logger.info("Mongo connected & seeded")
    else:
      logger.warning("Mongo not connected at startup; API will return 503 for DB endpoints")
  except Exception:
    logger.exception("Mongo startup failed")


@app.get("/api/health")
def health():
  return {"ok": True, "mongo": mongo_service.is_connected()}


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
def login(payload: UnifiedLoginRequest):
  identifier = payload.identifier.strip()
  if "@" in identifier:
    email = identifier.lower()
    user = mongo_service.find_user_by_email(email)
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
      logger.info("login failed email=%s", email)
      raise HTTPException(status_code=401, detail="invalid credentials")
    token = create_token({"role": "user", "email": user["email"]})
    logger.info("login success email=%s", email)
    return {"token": token, "user": {"role": "user", "email": user["email"], "name": user.get("name", "")}}

  username = sanitize_text(identifier, "username")
  admin = mongo_service.find_admin(username)
  if not admin:
    logger.info("admin login failed username=%s", username)
    raise HTTPException(status_code=401, detail="invalid credentials")
  if admin.get("password_hash"):
    valid = verify_password(payload.password, admin["password_hash"])
  else:
    valid = hmac.compare_digest(payload.password, str(admin.get("password", "")))
  if not valid:
    logger.info("admin login bad password username=%s", username)
    raise HTTPException(status_code=401, detail="invalid credentials")

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
  if not razorpay_enabled():
    raise HTTPException(status_code=503, detail="online advance payment is not configured")
  mongo_service.ensure_ready()
  booking = mongo_service.find_booking_by_id(payload.booking_id)
  if not booking:
    raise HTTPException(status_code=404, detail="booking not found")
  if booking.get("payment") not in (None, "", "unpaid"):
    raise HTTPException(status_code=400, detail="this booking is not awaiting advance payment")
  package_total = mongo_service.package_total_inr_for_booking(booking, None)
  if package_total is None:
    raise HTTPException(
      status_code=400,
      detail="this trip has no catalogue price; online advance is not available",
    )
  advance_inr, balance_inr = compute_advance_inr(package_total)
  amount_paise = max(MIN_AMOUNT_PAISE, advance_inr * 100)
  try:
    order = razorpay_create_order(
      amount_paise,
      receipt=payload.booking_id,
      notes={"booking_id": payload.booking_id},
    )
  except RazorpayAuthError as error:
    raise HTTPException(
      status_code=401,
      detail=(
        "Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env "
        "(Test mode keys from Dashboard → Account & Settings → API Keys), then restart the API."
      ),
    ) from error
  except (RazorpayOrderError, ValueError) as error:
    raise HTTPException(
      status_code=500,
      detail=str(error) or "Could not create Razorpay order",
    ) from error
  order_id = str(order.get("id") or "").strip()
  if not order_id:
    raise HTTPException(status_code=502, detail="could not create payment order")
  razorpay_amount = int(order.get("amount") or amount_paise)
  if razorpay_amount < MIN_AMOUNT_PAISE:
    raise HTTPException(status_code=502, detail="Razorpay returned an invalid order amount")
  if not mongo_service.set_booking_razorpay_order(
    payload.booking_id,
    order_id,
    package_total,
    advance_inr,
    amount_paise,
    RAZORPAY_KEY_ID,
  ):
    raise HTTPException(status_code=400, detail="could not attach payment order to booking")
  return {
    "order_id": order_id,
    "amount": razorpay_amount,
    "amount_paise": razorpay_amount,
    "currency": "INR",
    "key_id": RAZORPAY_KEY_ID,
    "package_total_inr": package_total,
    "advance_payment_inr": advance_inr,
    "balance_due_inr": balance_inr,
    "advance_percent": advance_percent(),
  }


# Standard Checkout aliases (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/)
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
  if not razorpay_enabled():
    raise HTTPException(status_code=503, detail="online advance payment is not configured")
  mongo_service.ensure_ready()
  order_id = payload.razorpay_order_id.strip()
  booking, booking_id = _resolve_booking_for_razorpay_payment(payload.booking_id, order_id)
  if booking.get("payment") == "advance_paid":
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
  if advance_inr < 1:
    package_total = mongo_service.package_total_inr_for_booking(booking, None)
    if package_total is None:
      raise HTTPException(status_code=400, detail="could not determine package total")
    advance_inr, _ = compute_advance_inr(package_total)
  mongo_service.set_booking_razorpay_payment_refs(booking_id, payload.razorpay_payment_id)
  return _admin_confirm_booking_payment(booking_id, advance_inr, None)


@app.post("/api/verify-payment")
def api_verify_payment_alias(payload: RazorpayVerifyRequest):
  """Verify Standard Checkout signature and confirm booking advance."""
  result = razorpay_verify_endpoint(payload)
  return {"success": True, **result}


@app.post("/api/bookings/guest")
def guest_booking(payload: GuestBookingRequest):
  tfields = _traveler_document_fields(payload.full_name, payload.additional_travelers)
  doc = {
    "tripType": "defined_trip",
    "tripId": payload.trip_id,
    "travelDestination": payload.travel_destination,
    "dateOfTravel": payload.date_of_travel,
    "fullName": payload.full_name,
    "mobile": payload.mobile,
    "email": payload.email,
    "numberOfPeople": payload.number_of_people,
    "payment": "unpaid",
    "source": "guest_booking",
    "createdAt": datetime.utcnow(),
    **tfields,
  }
  booking_id = _save_catalogue_booking(doc)
  logger.info("guest booking trip=%s email=%s", payload.travel_destination, payload.email)
  return _booking_response(booking_id)


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

  date_of_travel = str(payload.get("date_of_travel") or trip.get("startDate") or "").strip()
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

  raw_extras = payload.get("additional_travelers") or []
  if not isinstance(raw_extras, list):
    raw_extras = []
  extras: List[str] = []
  for x in raw_extras[:19]:
    s = str(x).strip()
    if s:
      extras.append(sanitize_text(s, "full_name"))
  need = people - 1
  if len(extras) != need:
    raise HTTPException(
      status_code=400,
      detail=f"Provide exactly {need} additional traveler name(s) for {people} people.",
    )
  lead_name = str(user.get("name") or "").strip()
  if people > 1 and len(lead_name) < 2:
    raise HTTPException(
      status_code=400,
      detail="Add your full name in Settings before booking for more than one person.",
    )
  tfields = _traveler_document_fields(lead_name or "Traveler", extras)

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
  booking_id = _save_catalogue_booking(doc)
  logger.info(
    "user booking trip=%s email=%s date=%s people=%s",
    trip.get("title"),
    user.get("email"),
    date_of_travel,
    people,
  )
  return _booking_response(booking_id)


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

  return _apply_booking_member_update(booking_id, payload.additional_travelers, "user")


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
  return _apply_booking_member_update(booking_id, payload.additional_travelers, "admin")


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


if __name__ == "__main__":
  import uvicorn

  uvicorn.run(app, host=HOST, port=PORT)
