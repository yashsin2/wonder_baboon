import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import certifi
from bson import ObjectId
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError, PyMongoError

from auth_utils import hash_password
from config import ADMIN_PASSWORD, ADMIN_USERNAME, MONGO_URI
from models import TRIP_STYLE_SLUGS

logger = logging.getLogger(__name__)

DEFAULT_TRIP_STYLE = "backpackers"


def normalize_trip_style(value: Optional[str]) -> str:
  slug = (value or "").strip().lower()
  if slug in TRIP_STYLE_SLUGS:
    return slug
  return DEFAULT_TRIP_STYLE


class MongoService:
  def __init__(self) -> None:
    self._client: Optional[MongoClient] = None
    self._db: Optional[Database] = None
    self._ready = False

  def connect(self) -> None:
    if not MONGO_URI:
      raise RuntimeError(
        "This server isn't set up to reach the database. Please contact support."
      )
    self._client = MongoClient(
      MONGO_URI,
      serverSelectionTimeoutMS=10000,
      tlsCAFile=certifi.where(),
    )
    try:
      self._client.admin.command("ping")
      self._db = self._client["userlogindetails"]
      self._ready = True
    except PyMongoError as error:
      logger.warning("MongoDB connection failed on startup: %s", error)
      self._ready = False

  def ensure_ready(self) -> None:
    if self._ready and self._db is not None:
      return
    if self._client is None:
      self.connect()
    if not self._ready or self._db is None:
      logger.error("MongoDB unavailable: ensure_ready failed (connected=%s)", self._ready)
      raise RuntimeError(
        "We can't load your data right now. Please try again in a few minutes."
      )

  def is_connected(self) -> bool:
    return self._ready

  @property
  def db(self) -> Database:
    self.ensure_ready()
    return self._db  # type: ignore[return-value]

  @property
  def admin_collection(self) -> Collection:
    return self.db["admin_login"]

  @property
  def user_collection(self) -> Collection:
    return self.db["user_login"]

  @property
  def add_trip_collection(self) -> Collection:
    return self.db["add_trip_detail"]

  @property
  def user_trip_collection(self) -> Collection:
    return self.db["user_trip_details"]

  @property
  def otp_collection(self) -> Collection:
    return self.db["profile_otps"]

  def seed_defaults(self) -> None:
    self.admin_collection.create_index([("username", ASCENDING)], unique=True)
    self.user_collection.create_index([("email", ASCENDING)], unique=True)
    self.user_collection.create_index([("mobile", ASCENDING)], unique=True, sparse=True)
    self.add_trip_collection.create_index([("slug", ASCENDING)], unique=True)
    self.user_trip_collection.create_index([("createdAt", DESCENDING)])
    self.user_trip_collection.create_index([("email", ASCENDING)])
    self.otp_collection.create_index([("userEmail", ASCENDING), ("kind", ASCENDING)])
    self.otp_collection.create_index([("createdAt", DESCENDING)])
    self.otp_collection.create_index([("expiresAt", ASCENDING)], expireAfterSeconds=0)
    logger.info("Mongo indexes ensured")

    self.backfill_booking_payment()

    if not self.admin_collection.find_one({"username": ADMIN_USERNAME}):
      self.admin_collection.insert_one(
        {
          "username": ADMIN_USERNAME,
          "password_hash": hash_password(ADMIN_PASSWORD),
          "createdAt": datetime.utcnow(),
        }
      )

    if self.add_trip_collection.count_documents({}) == 0:
      self.add_trip_collection.insert_many(
        [
          {
            "title": "Spiti Circuit + Chandratal",
            "slug": "spiti-circuit-chandratal",
            "location": "Himachal Pradesh",
            "durationLabel": "7D/6N",
            "price": 15999,
            "startDate": "2026-06-12",
            "endDate": "2026-06-18",
            "imageUrl": "./assets/lake.jpg",
            "published": True,
            "tripStyle": "hikers",
            "createdAt": datetime.utcnow(),
          },
          {
            "title": "Varanasi Explorer",
            "slug": "varanasi-explorer",
            "location": "Uttar Pradesh",
            "durationLabel": "3D/2N",
            "price": 3499,
            "startDate": "2026-06-20",
            "endDate": "2026-06-22",
            "imageUrl": "./assets/banaras.jpg",
            "published": True,
            "tripStyle": "backpackers",
            "createdAt": datetime.utcnow(),
          },
          {
            "title": "Rishikesh Weekend",
            "slug": "rishikesh-weekend",
            "location": "Uttarakhand",
            "durationLabel": "2D/1N",
            "price": 3499,
            "startDate": "2026-06-28",
            "endDate": "2026-06-29",
            "imageUrl": "./assets/rishikesh1.jpg",
            "published": True,
            "tripStyle": "dolce_far_niente",
            "createdAt": datetime.utcnow(),
          },
          {
            "title": "Nagtibba Trek",
            "slug": "nagtibba-trek",
            "location": "Uttarakhand",
            "durationLabel": "2D/1N",
            "price": 3499,
            "startDate": "2026-07-05",
            "endDate": "2026-07-06",
            "imageUrl": "./assets/nagtibba3.jpg",
            "published": True,
            "tripStyle": "hikers",
          },
        ]
      )

  def create_user(self, user_doc: dict) -> None:
    try:
      self.user_collection.insert_one(user_doc)
      logger.info("user created email=%s", user_doc.get("email"))
    except DuplicateKeyError as exc:
      logger.info("signup duplicate: %s", exc)
      raise ValueError("user already exists")

  def find_admin(self, username: str) -> Optional[dict]:
    return self.admin_collection.find_one({"username": username})

  def find_user_by_email(self, email: str) -> Optional[dict]:
    return self.user_collection.find_one({"email": email})

  def find_user_by_mobile(self, mobile: str) -> Optional[dict]:
    return self.user_collection.find_one({"mobile": mobile})

  def update_user_name(self, email: str, name: str) -> bool:
    result = self.user_collection.update_one({"email": email}, {"$set": {"name": name}})
    logger.info("update name email=%s matched=%s", email, result.matched_count)
    return result.matched_count > 0

  def update_user_email(self, current_email: str, new_email: str) -> bool:
    try:
      result = self.user_collection.update_one(
        {"email": current_email}, {"$set": {"email": new_email}}
      )
      if result.matched_count == 0:
        return False
      self.user_trip_collection.update_many(
        {"email": current_email}, {"$set": {"email": new_email}}
      )
      logger.info("update email %s -> %s", current_email, new_email)
      return True
    except DuplicateKeyError:
      logger.info("email change blocked: %s already exists", new_email)
      raise ValueError("email already in use")

  def update_user_mobile(self, email: str, mobile: str) -> bool:
    try:
      result = self.user_collection.update_one({"email": email}, {"$set": {"mobile": mobile}})
      logger.info("update mobile email=%s matched=%s", email, result.matched_count)
      return result.matched_count > 0
    except DuplicateKeyError:
      logger.info("mobile change blocked: %s already exists", mobile)
      raise ValueError("mobile already in use")

  def save_otp(self, doc: dict) -> None:
    self.otp_collection.insert_one(doc)

  def find_latest_otp(self, user_email: str, kind: str) -> Optional[dict]:
    return self.otp_collection.find_one(
      {"userEmail": user_email, "kind": kind},
      sort=[("createdAt", DESCENDING)],
    )

  def consume_otp(self, otp_id) -> None:
    self.otp_collection.update_one({"_id": otp_id}, {"$set": {"consumed": True}})

  def increment_otp_attempts(self, otp_id) -> None:
    self.otp_collection.update_one({"_id": otp_id}, {"$inc": {"attempts": 1}})

  def _serialize_trip(self, trip: dict) -> None:
    trip["_id"] = str(trip["_id"])
    trip["tripStyle"] = normalize_trip_style(trip.get("tripStyle"))
    image = trip.get("imageUrl") or "./assets/lake.jpg"
    if image.startswith("./assets/"):
      trip["imageUrl"] = image
    elif image.startswith("assets/"):
      trip["imageUrl"] = f"./{image}"
    else:
      trip["imageUrl"] = f"./assets/{image.split('/')[-1]}"

  def list_published_trips(self) -> List[dict]:
    trips = list(
      self.add_trip_collection.find(
        {"published": True},
        {
          "_id": 1,
          "title": 1,
          "location": 1,
          "durationLabel": 1,
          "price": 1,
          "startDate": 1,
          "endDate": 1,
          "imageUrl": 1,
          "itineraryHtml": 1,
          "tripStyle": 1,
        },
      ).sort("startDate", ASCENDING)
    )
    for trip in trips:
      self._serialize_trip(trip)
    return trips

  def backfill_booking_payment(self) -> None:
    """Legacy bookings without payment default to unpaid."""
    try:
      result = self.user_trip_collection.update_many(
        {"$or": [{"payment": {"$exists": False}}, {"payment": None}, {"payment": ""}]},
        {"$set": {"payment": "unpaid"}},
      )
      if result.modified_count:
        logger.info("backfilled payment=unpaid on %s bookings", result.modified_count)
    except PyMongoError as exc:
      logger.warning("backfill booking payment skipped: %s", exc)

  def insert_booking(self, doc: dict) -> str:
    result = self.user_trip_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return str(result.inserted_id)

  def set_booking_razorpay_order(
    self,
    booking_id: str,
    razorpay_order_id: str,
    package_total_inr: int,
    advance_inr: int,
    amount_paise: int,
    razorpay_key_id: str = "",
  ) -> bool:
    raw = (booking_id or "").strip()
    if not raw:
      return False
    id_clauses: List[Dict[str, Any]] = [{"_id": raw}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(raw)})
    except Exception:
      pass
    result = self.user_trip_collection.update_one(
      {"$and": [{"$or": id_clauses}, {"payment": "unpaid"}]},
      {
        "$set": {
          "razorpayOrderId": razorpay_order_id,
          "razorpayKeyId": (razorpay_key_id or "").strip(),
          "razorpayPackageTotalInr": int(package_total_inr),
          "razorpayAdvanceInr": int(advance_inr),
          "razorpayAmountPaise": int(amount_paise),
        }
      },
    )
    return result.matched_count > 0

  def set_booking_razorpay_payment_refs(self, booking_id: str, razorpay_payment_id: str) -> bool:
    raw = (booking_id or "").strip()
    if not raw:
      return False
    id_clauses: List[Dict[str, Any]] = [{"_id": raw}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(raw)})
    except Exception:
      pass
    result = self.user_trip_collection.update_one(
      {"$or": id_clauses},
      {"$set": {"razorpayPaymentId": razorpay_payment_id}},
    )
    return result.matched_count > 0

  def find_booking_by_id(self, booking_id: str) -> Optional[dict]:
    raw = (booking_id or "").strip()
    if not raw:
      return None
    id_clauses: List[Dict[str, Any]] = [{"_id": raw}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(raw)})
    except Exception:
      pass
    return self.user_trip_collection.find_one({"$or": id_clauses})

  def find_booking_by_razorpay_order_id(self, razorpay_order_id: str) -> Optional[dict]:
    oid = (razorpay_order_id or "").strip()
    if not oid:
      return None
    return self.user_trip_collection.find_one({"razorpayOrderId": oid})

  def package_total_inr_for_booking(self, booking: dict, trip_total_override: Optional[int]) -> Optional[int]:
    """Catalogue trip: price × headcount; planned trip: requires admin override."""
    people = max(1, int(booking.get("numberOfPeople") or 1))
    if booking.get("tripType") == "defined_trip" and booking.get("tripId"):
      trip = self.find_trip_by_id(str(booking["tripId"]))
      if trip and trip.get("price") is not None:
        try:
          return int(trip["price"]) * people
        except (TypeError, ValueError):
          pass
      if trip_total_override is None:
        return None
      return trip_total_override
    if booking.get("tripType") == "planned_trip":
      if trip_total_override is None:
        return None
      return trip_total_override
    if trip_total_override is not None:
      return trip_total_override
    return None

  def confirm_booking_with_payment_breakdown(
    self,
    booking_id: str,
    package_total_inr: int,
    advance_payment_inr: int,
    balance_due_inr: int,
  ) -> bool:
    raw = (booking_id or "").strip()
    if not raw:
      return False
    now = datetime.utcnow()
    balance = int(balance_due_inr)
    payment_status = "paid" if balance <= 0 else "advance_paid"
    update: Dict[str, Any] = {
      "$set": {
        "payment": payment_status,
        "confirmed": True,
        "confirmedAt": now,
        "packageTotalInr": int(package_total_inr),
        "advancePaymentInr": int(advance_payment_inr),
        "balanceDueInr": max(0, balance),
      }
    }
    if payment_status == "paid":
      update["$set"]["fullyPaidAt"] = now
    id_clauses: List[Dict[str, Any]] = [{"_id": raw}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(raw)})
    except Exception:
      pass
    result = self.user_trip_collection.update_one({"$or": id_clauses}, update)
    return result.matched_count > 0

  def mark_booking_fully_paid(self, booking_id: str) -> Optional[dict]:
    """Record remaining balance received; booking must be advance_paid."""
    raw = (booking_id or "").strip()
    if not raw:
      return None
    booking = self.find_booking_by_id(raw)
    if not booking:
      return None
    if booking.get("payment") != "advance_paid":
      return None
    package_total = int(booking.get("packageTotalInr") or 0)
    if package_total <= 0:
      return None
    now = datetime.utcnow()
    update = {
      "$set": {
        "payment": "paid",
        "advancePaymentInr": package_total,
        "balanceDueInr": 0,
        "fullyPaidAt": now,
      }
    }
    id_clauses: List[Dict[str, Any]] = [{"_id": raw}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(raw)})
    except Exception:
      pass
    result = self.user_trip_collection.update_one({"$or": id_clauses}, update)
    if result.matched_count == 0:
      return None
    return self.find_booking_by_id(raw)

  def set_booking_payment_paid(self, booking_id: str) -> bool:
    """Legacy: marks paid without payment breakdown (prefer confirm_booking_with_payment_breakdown)."""
    raw = (booking_id or "").strip()
    if not raw:
      return False
    update = {"$set": {"payment": "paid", "confirmedAt": datetime.utcnow()}}
    id_clauses: List[Dict[str, Any]] = [{"_id": raw}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(raw)})
    except Exception:
      pass
    result = self.user_trip_collection.update_one({"$or": id_clauses}, update)
    return result.matched_count > 0

  def find_trip_by_id(self, trip_id: str) -> Optional[dict]:
    try:
      object_id = ObjectId(trip_id)
    except Exception:
      return None
    return self.add_trip_collection.find_one({"_id": object_id})

  def _trip_object_id(self, trip_id: str) -> ObjectId:
    return ObjectId(trip_id)

  def add_trip(self, payload: dict) -> str:
    slug = re.sub(r"[^a-z0-9-]", "", payload["title"].lower().strip().replace(" ", "-"))
    doc = {
      "title": payload["title"],
      "slug": slug,
      "location": payload["location"],
      "durationLabel": payload["duration_label"],
      "price": payload["price"],
      "startDate": payload["start_date"],
      "endDate": payload["end_date"],
      "imageUrl": f"./assets/{payload['image_name']}",
      "published": payload.get("published", True),
      "tripStyle": normalize_trip_style(payload.get("trip_style")),
      "createdAt": datetime.utcnow(),
    }
    if payload.get("itineraryHtml"):
      doc["itineraryHtml"] = str(payload["itineraryHtml"])[:800_000]
      doc["itineraryUpdatedAt"] = datetime.utcnow()
    result = self.add_trip_collection.insert_one(doc)
    return str(result.inserted_id)

  def update_trip(self, trip_id: str, fields: Dict[str, Any]) -> bool:
    """Partial update. Keys are API names: title, location, duration_label, price, start_date, end_date, image_name, published."""
    try:
      oid = self._trip_object_id(trip_id)
    except Exception:
      return False

    update: Dict[str, Any] = {}
    if "title" in fields and fields["title"] is not None:
      title = str(fields["title"]).strip()
      update["title"] = title
      new_slug = re.sub(r"[^a-z0-9-]", "", title.lower().replace(" ", "-"))
      conflict = self.add_trip_collection.find_one({"slug": new_slug, "_id": {"$ne": oid}})
      if conflict:
        raise ValueError("another trip already uses this title slug; choose a different title")
      update["slug"] = new_slug
    if "location" in fields and fields["location"] is not None:
      update["location"] = str(fields["location"]).strip()
    if "duration_label" in fields and fields["duration_label"] is not None:
      update["durationLabel"] = str(fields["duration_label"]).strip()
    if "price" in fields and fields["price"] is not None:
      update["price"] = int(fields["price"])
    if "start_date" in fields and fields["start_date"] is not None:
      update["startDate"] = str(fields["start_date"]).strip()
    if "end_date" in fields and fields["end_date"] is not None:
      update["endDate"] = str(fields["end_date"]).strip()
    if "published" in fields and fields["published"] is not None:
      update["published"] = bool(fields["published"])
    if "trip_style" in fields and fields["trip_style"] is not None:
      update["tripStyle"] = normalize_trip_style(str(fields["trip_style"]))
    if "image_name" in fields and fields["image_name"] is not None:
      iname = str(fields["image_name"]).strip()
      update["imageUrl"] = f"./assets/{iname}"

    if not update:
      return True

    result = self.add_trip_collection.update_one({"_id": oid}, {"$set": update})
    return result.matched_count > 0

  def delete_trip(self, trip_id: str) -> bool:
    try:
      oid = self._trip_object_id(trip_id)
    except Exception:
      return False
    result = self.add_trip_collection.delete_one({"_id": oid})
    return result.deleted_count > 0

  def set_trip_itinerary_html(self, trip_id: str, html_fragment: Optional[str]) -> bool:
    try:
      oid = self._trip_object_id(trip_id)
    except Exception:
      return False
    if html_fragment is None:
      result = self.add_trip_collection.update_one(
        {"_id": oid},
        {"$unset": {"itineraryHtml": "", "itineraryUpdatedAt": ""}},
      )
      return result.matched_count > 0
    trimmed = str(html_fragment)[:800_000]
    result = self.add_trip_collection.update_one(
      {"_id": oid},
      {"$set": {"itineraryHtml": trimmed, "itineraryUpdatedAt": datetime.utcnow()}},
    )
    return result.matched_count > 0

  def _effective_payment_status(self, booking: dict) -> str:
    """Align payment label with balance (fixes stale paid + balance > 0)."""
    current = str(booking.get("payment") or "unpaid").strip().lower()
    balance = int(booking.get("balanceDueInr") or 0)
    package = int(booking.get("packageTotalInr") or 0)
    if current == "paid" and balance > 0:
      return "advance_paid"
    if current == "advance_paid" and balance <= 0 and package > 0:
      return "paid"
    if current in ("paid", "advance_paid", "unpaid"):
      return current
    return "unpaid"

  def _sync_booking_payment_status(self, booking: dict, *, persist: bool = False) -> None:
    if not booking:
      return
    effective = self._effective_payment_status(booking)
    current = str(booking.get("payment") or "unpaid")
    if effective == current:
      return
    booking["payment"] = effective
    if not persist:
      return
    raw_id = booking.get("_id")
    if raw_id is None:
      return
    update: Dict[str, Any] = {"$set": {"payment": effective}}
    if effective == "paid":
      update["$set"]["fullyPaidAt"] = datetime.utcnow()
    elif current == "paid":
      update["$unset"] = {"fullyPaidAt": ""}
    id_clauses: List[Dict[str, Any]] = [{"_id": raw_id}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(str(raw_id))})
    except Exception:
      pass
    self.user_trip_collection.update_one({"$or": id_clauses}, update)

  @staticmethod
  def booking_visible_to_traveler(booking: dict) -> bool:
    """Unpaid online-advance bookings stay in DB for admin but not on Your trips."""
    payment = str(booking.get("payment") or "unpaid").strip().lower()
    if payment in ("advance_paid", "paid"):
      return True
    if booking.get("confirmed") is True:
      return True
    return False

  def list_user_bookings(self, email: str, mobile: Optional[str] = None) -> List[dict]:
    clauses: List[Dict[str, Any]] = [{"email": email}]
    m = (mobile or "").strip()
    if m:
      clauses.append({"mobile": m})
    query: Dict[str, Any] = {"$or": clauses} if len(clauses) > 1 else clauses[0]
    bookings = list(self.user_trip_collection.find(query).sort("dateOfTravel", DESCENDING))
    visible: List[dict] = []
    for booking in bookings:
      booking["_id"] = str(booking["_id"])
      self._sync_booking_payment_status(booking)
      if not self.booking_visible_to_traveler(booking):
        continue
      tid = booking.get("tripId")
      if tid:
        trip = self.find_trip_by_id(str(tid))
        if trip and trip.get("itineraryHtml"):
          booking["itineraryHtml"] = trip["itineraryHtml"]
      visible.append(booking)
    return visible

  def get_admin_stats(self) -> Dict[str, Any]:
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_end = month_start + timedelta(days=32)
    month_end = month_end.replace(day=1) - timedelta(seconds=1)

    total_bookings = self.user_trip_collection.count_documents({})
    paid_bookings = self.user_trip_collection.count_documents({"payment": "paid"})
    advance_paid_bookings = self.user_trip_collection.count_documents({"payment": "advance_paid"})
    unpaid_bookings = self.user_trip_collection.count_documents(
      {"$or": [{"payment": "unpaid"}, {"payment": {"$exists": False}}, {"payment": None}, {"payment": ""}]}
    )

    return {
      "totalTrips": self.add_trip_collection.count_documents({}),
      "totalBookings": total_bookings,
      "paidBookings": paid_bookings,
      "advancePaidBookings": advance_paid_bookings,
      "unpaidBookings": unpaid_bookings,
      "monthBookings": self.user_trip_collection.count_documents(
        {"createdAt": {"$gte": month_start, "$lte": month_end}}
      ),
      "definedTripBookings": self.user_trip_collection.count_documents({"tripType": "defined_trip"}),
      "plannedTripBookings": self.user_trip_collection.count_documents({"tripType": "planned_trip"}),
      "currentMonth": datetime.utcnow().strftime("%B %Y"),
    }

  def search_bookings(self, search: str) -> List[dict]:
    query: dict = {}
    if search.strip():
      term = search.strip()
      query = {
        "$or": [
          {"travelDestination": {"$regex": term, "$options": "i"}},
          {"fullName": {"$regex": term, "$options": "i"}},
          {"mobile": {"$regex": term, "$options": "i"}},
          {"email": {"$regex": term, "$options": "i"}},
        ]
      }
    bookings = list(self.user_trip_collection.find(query).sort("createdAt", DESCENDING))
    for booking in bookings:
      booking["_id"] = str(booking["_id"])
      total = self.package_total_inr_for_booking(booking, None)
      if total is not None:
        booking["computedPackageTotalInr"] = total
      self._sync_booking_payment_status(booking, persist=True)
    return bookings

  def search_trips(self, search: str) -> List[dict]:
    query: dict = {}
    if search.strip():
      query = {"title": {"$regex": search.strip(), "$options": "i"}}
    trips = list(self.add_trip_collection.find(query).sort("createdAt", DESCENDING))
    for trip in trips:
      self._serialize_trip(trip)
    return trips

  def _booking_id_clauses(self, booking_id: str) -> List[Dict[str, Any]]:
    raw = (booking_id or "").strip()
    id_clauses: List[Dict[str, Any]] = [{"_id": raw}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(raw)})
    except Exception:
      pass
    return id_clauses

  def delete_booking(self, booking_id: str) -> bool:
    raw = (booking_id or "").strip()
    if not raw:
      return False
    result = self.user_trip_collection.delete_one({"$or": self._booking_id_clauses(raw)})
    return result.deleted_count > 0

  def recalculate_booking_totals(self, booking: dict, new_people: int) -> Dict[str, int]:
    people = max(1, min(20, int(new_people)))
    if booking.get("tripType") == "defined_trip" and booking.get("tripId"):
      trip = self.find_trip_by_id(str(booking["tripId"]))
      if trip and trip.get("price") is not None:
        per_person = int(trip["price"])
        new_total = per_person * people
      else:
        old_people = max(1, int(booking.get("numberOfPeople") or 1))
        old_total = int(booking.get("packageTotalInr") or 0)
        if old_total <= 0:
          estimate = self.package_total_inr_for_booking(booking, None)
          old_total = int(estimate or 0)
        per_person = old_total // old_people if old_people else old_total
        new_total = per_person * people
    else:
      old_people = max(1, int(booking.get("numberOfPeople") or 1))
      old_total = int(booking.get("packageTotalInr") or 0)
      if old_total <= 0:
        estimate = self.package_total_inr_for_booking(booking, None)
        old_total = int(estimate or 0)
      if old_total <= 0:
        new_total = 0
      else:
        per_person = round(old_total / old_people)
        new_total = per_person * people

    advance = int(booking.get("advancePaymentInr") or 0)
    balance = max(0, new_total - advance)
    return {
      "packageTotalInr": new_total,
      "advancePaymentInr": advance,
      "balanceDueInr": balance,
    }

  def _payment_status_after_member_update(self, booking: dict, totals: Dict[str, int]) -> str:
    balance = int(totals["balanceDueInr"])
    advance = int(totals["advancePaymentInr"])
    if balance <= 0:
      return "paid"
    if advance > 0 or booking.get("payment") in ("paid", "advance_paid"):
      return "advance_paid"
    return "unpaid"

  def update_booking_members(
    self,
    booking_id: str,
    traveler_fields: Dict[str, Any],
    new_people: int,
    triggered_by: str,
    old_people: int,
  ) -> Optional[dict]:
    raw = (booking_id or "").strip()
    if not raw:
      return None
    booking = self.find_booking_by_id(raw)
    if not booking:
      return None

    totals = self.recalculate_booking_totals(booking, new_people)
    payment_status = self._payment_status_after_member_update(booking, totals)
    history_entry = {
      "at": datetime.utcnow(),
      "triggeredBy": triggered_by,
      "oldPeople": old_people,
      "newPeople": new_people,
    }

    unset_fields: Dict[str, str] = {}
    for i in range(new_people + 1, 21):
      unset_fields[f"traveler{i}"] = ""

    update_set: Dict[str, Any] = {
      "numberOfPeople": new_people,
      **traveler_fields,
      **totals,
      "payment": payment_status,
    }
    if payment_status == "paid":
      update_set["fullyPaidAt"] = datetime.utcnow()
    elif booking.get("payment") == "paid" and payment_status == "advance_paid":
      unset_fields["fullyPaidAt"] = ""

    update_doc: Dict[str, Any] = {
      "$set": update_set,
      "$push": {"memberChangeHistory": history_entry},
    }
    if unset_fields:
      update_doc["$unset"] = unset_fields

    result = self.user_trip_collection.update_one({"$or": self._booking_id_clauses(raw)}, update_doc)
    if not result.matched_count:
      return None
    refreshed = self.find_booking_by_id(raw)
    if refreshed:
      refreshed["_id"] = str(refreshed["_id"])
    return refreshed


mongo_service = MongoService()
