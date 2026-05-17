import hmac
import logging
import time
import uuid
from datetime import datetime
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from auth_utils import create_token, decode_token, hash_password, require_admin, sanitize_text, verify_password
from config import CORS_ORIGINS, HOST, IS_PRODUCTION, JWT_SECRET, PORT
from logging_setup import configure_logging
from models import (
  AdminConfirmBookingRequest,
  AdminTripCreateRequest,
  EmailOtpRequest,
  GuestBookingRequest,
  MobileOtpRequest,
  OtpVerifyRequest,
  PlannedTripRequest,
  ProfileNameUpdateRequest,
  UnifiedLoginRequest,
  UserSignupRequest,
)
from middleware.auth_rate_limit import auth_rate_limit_middleware
from services.email_service import email_service
from services.mongo_service import mongo_service
from services.otp_service import otp_service

if not JWT_SECRET:
  raise RuntimeError("JWT_SECRET is required")

configure_logging()
logger = logging.getLogger("wb.main")

app = FastAPI(title="Wonder Baboon API")

app.add_middleware(
  CORSMiddleware,
  allow_origins=CORS_ORIGINS,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


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
  return {"trips": mongo_service.list_published_trips()}


@app.post("/api/bookings/guest")
def guest_booking(payload: GuestBookingRequest):
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
  }
  mongo_service.insert_booking(doc)
  email_service.notify_new_booking(doc)
  logger.info("guest booking trip=%s email=%s", payload.travel_destination, payload.email)
  return {"message": "booking saved"}


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
  }
  mongo_service.insert_booking(doc)
  email_service.notify_new_booking(doc)
  logger.info(
    "user booking trip=%s email=%s date=%s people=%s",
    trip.get("title"),
    user.get("email"),
    date_of_travel,
    people,
  )
  return {"message": "booking saved"}


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
  }
  mongo_service.insert_booking(doc)
  email_service.notify_new_booking(doc)
  logger.info("planned trip dest=%s email=%s", payload.travel_destination, payload.email)
  return {"message": "planned trip saved"}


@app.get("/api/admin/stats")
def admin_stats(_: dict = Depends(require_admin)):
  return mongo_service.get_admin_stats()


@app.get("/api/admin/bookings")
def admin_bookings(search: str = "", _: dict = Depends(require_admin)):
  return {"bookings": mongo_service.search_bookings(search)}


@app.patch("/api/admin/bookings/{booking_id}/confirm")
def admin_confirm_booking(booking_id: str, _: dict = Depends(require_admin)):
  ok = mongo_service.set_booking_payment_paid(booking_id)
  if not ok:
    raise HTTPException(status_code=404, detail="booking not found")
  return {"message": "booking confirmed", "payment": "paid"}


@app.post("/api/admin/bookings/confirm-payment")
def admin_confirm_booking_post(payload: AdminConfirmBookingRequest, _: dict = Depends(require_admin)):
  ok = mongo_service.set_booking_payment_paid(payload.booking_id)
  if not ok:
    raise HTTPException(status_code=404, detail="booking not found")
  return {"message": "booking confirmed", "payment": "paid"}


@app.get("/api/admin/trips")
def admin_trips(search: str = "", _: dict = Depends(require_admin)):
  return {"trips": mongo_service.search_trips(search)}


@app.post("/api/admin/trips")
def admin_add_trip(payload: AdminTripCreateRequest, _: dict = Depends(require_admin)):
  mongo_service.add_trip(payload.model_dump())
  return {"message": "trip detail added"}


if __name__ == "__main__":
  import uvicorn

  uvicorn.run(app, host=HOST, port=PORT)
