import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import certifi
from bson import ObjectId
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError, PyMongoError

from auth_utils import hash_password
from config import ADMIN_PASSWORD, ADMIN_USERNAME, MONGO_URI, ROOT_DIR, TRAVEL_GALLERY_COLLECTION
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
    if self._client is not None:
      try:
        self._client.close()
      except Exception:
        pass
      self._client = None
      self._db = None
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
      logger.warning("MongoDB connection failed: %s", error)
      self._ready = False
      try:
        self._client.close()
      except Exception:
        pass
      self._client = None
      self._db = None

  def ensure_ready(self) -> None:
    if self._ready and self._db is not None:
      return
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

  @property
  def travel_gallery_collection(self) -> Collection:
    return self.db[TRAVEL_GALLERY_COLLECTION]

  def seed_defaults(self) -> None:
    self.admin_collection.create_index([("username", ASCENDING)], unique=True)
    self.user_collection.create_index([("email", ASCENDING)], unique=True)
    self.user_collection.create_index([("mobile", ASCENDING)], unique=True, sparse=True)
    self.add_trip_collection.create_index([("slug", ASCENDING)], unique=True)
    self.user_trip_collection.create_index([("createdAt", DESCENDING)])
    self.user_trip_collection.create_index([("email", ASCENDING)])
    self.user_trip_collection.create_index([("travelerContacts.email", ASCENDING)])
    self.user_trip_collection.create_index([("travelerContacts.mobile", ASCENDING)])
    self.otp_collection.create_index([("userEmail", ASCENDING), ("kind", ASCENDING)])
    self.otp_collection.create_index([("createdAt", DESCENDING)])
    self.otp_collection.create_index([("expiresAt", ASCENDING)], expireAfterSeconds=0)
    self.travel_gallery_collection.create_index([("id", ASCENDING)], unique=True)
    self.travel_gallery_collection.create_index([("sortOrder", ASCENDING)])
    logger.info("Mongo indexes ensured")

    self.backfill_booking_payment()
    self._init_travel_gallery()

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

  def update_user_password(self, email: str, password_hash: str) -> bool:
    result = self.user_collection.update_one({"email": email}, {"$set": {"password_hash": password_hash}})
    logger.info("update password email=%s matched=%s", email, result.matched_count)
    return result.matched_count > 0

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
    payment_kind: str = "advance",
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
          "razorpayPaymentKind": (payment_kind or "advance").strip(),
        }
      },
    )
    return result.matched_count > 0

  def set_booking_razorpay_balance_order(
    self,
    booking_id: str,
    razorpay_order_id: str,
    balance_inr: int,
    amount_paise: int,
    razorpay_key_id: str = "",
  ) -> bool:
    """Attach a Razorpay order for the remaining balance (advance_paid bookings)."""
    raw = (booking_id or "").strip()
    if not raw:
      return False
    id_clauses: List[Dict[str, Any]] = [{"_id": raw}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(raw)})
    except Exception:
      pass
    result = self.user_trip_collection.update_one(
      {"$and": [{"$or": id_clauses}, {"payment": "advance_paid"}]},
      {
        "$set": {
          "razorpayOrderId": razorpay_order_id,
          "razorpayKeyId": (razorpay_key_id or "").strip(),
          "razorpayAdvanceInr": int(balance_inr),
          "razorpayAmountPaise": int(amount_paise),
          "razorpayPaymentKind": "balance",
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

  def list_paid_bookings_pending_completion_email(self) -> List[dict]:
    """Fully paid bookings that have not yet received a trip-completed email."""
    query: Dict[str, Any] = {
      "payment": "paid",
      "$or": [
        {"completionEmailSentAt": {"$exists": False}},
        {"completionEmailSentAt": None},
      ],
    }
    return list(self.user_trip_collection.find(query))

  def mark_completion_email_sent(self, booking_id: str) -> bool:
    raw = (booking_id or "").strip()
    if not raw:
      return False
    id_clauses: List[Dict[str, Any]] = [{"_id": raw}]
    try:
      id_clauses.insert(0, {"_id": ObjectId(raw)})
    except Exception:
      pass
    result = self.user_trip_collection.update_one(
      {
        "$and": [
          {"$or": id_clauses},
          {
            "$or": [
              {"completionEmailSentAt": {"$exists": False}},
              {"completionEmailSentAt": None},
            ]
          },
        ]
      },
      {"$set": {"completionEmailSentAt": datetime.utcnow()}},
    )
    return result.matched_count > 0

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
    """Bookings the user owns, plus bookings where they were added as an additional traveler."""
    email_l = (email or "").strip().lower()
    m = (mobile or "").strip()
    clauses: List[Dict[str, Any]] = [{"email": email}]
    if email_l:
      clauses.append({"travelerContacts.email": email_l})
    if m:
      clauses.append({"mobile": m})
      clauses.append({"travelerContacts.mobile": m})
    query: Dict[str, Any] = {"$or": clauses} if len(clauses) > 1 else clauses[0]
    bookings = list(self.user_trip_collection.find(query).sort("dateOfTravel", DESCENDING))
    visible: List[dict] = []
    for booking in bookings:
      booking["_id"] = str(booking["_id"])
      self._sync_booking_payment_status(booking)
      if not self.booking_visible_to_traveler(booking):
        continue
      is_owner = (str(booking.get("email") or "").strip().lower() == email_l and email_l) or (
        m and str(booking.get("mobile") or "").strip() == m
      )
      if is_owner:
        booking["viewerRole"] = "owner"
      else:
        # Companion: can see the trip, but not the lead's or other travelers' contact details.
        booking["viewerRole"] = "companion"
        for key in ("email", "mobile", "travelerContacts"):
          booking.pop(key, None)
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
      term = re.escape(search.strip()[:80])
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
      query = {"title": {"$regex": re.escape(search.strip()[:80]), "$options": "i"}}
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

  # ── Travel Gallery: State → Places → Visits ───────────────────────────────
  # One document per state. `places` is an array; each place has an array of `visits`
  # (one per trip), so going to Jibhi twice just adds a second visit to the same place.

  def _load_travel_gallery_seed(self) -> List[dict]:
    seed_path = ROOT_DIR / "backend" / "data" / "travel_gallery_seed.json"
    if not seed_path.is_file():
      logger.warning("travel gallery seed file missing: %s", seed_path)
      return []
    try:
      raw = json.loads(seed_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
      logger.warning("travel gallery seed load failed: %s", error)
      return []
    if not isinstance(raw, list):
      return []
    return [item for item in raw if isinstance(item, dict) and item.get("id")]

  @staticmethod
  def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")[:48]

  @classmethod
  def _legacy_state_to_places(cls, item: dict) -> dict:
    """Convert an old one-trip-per-state document into State → Places → Visits."""
    if isinstance(item.get("places"), list):
      return item
    out = {
      key: item[key]
      for key in ("id", "state", "svgStateId", "mapPin", "status", "pinSubtitle", "heroImage", "sortOrder")
      if key in item
    }
    out["title"] = item.get("title") or item.get("state")
    out["places"] = []
    has_content = item.get("photos") or item.get("testimonials") or item.get("highlights") or item.get("story")
    if has_content:
      label = (item.get("tripLabel") or "").strip()
      name = re.sub(r"\s+(backpacking\s+)?(trip|tour)$", "", label, flags=re.IGNORECASE).strip() or item.get("state", "")
      photos = list(item.get("photos") or [])
      out["places"].append(
        {
          "id": cls._slugify(name) or "place",
          "name": name,
          "tagline": label,
          "description": "",
          "heroImage": item.get("heroImage") or (photos[0] if photos else ""),
          **cls._KNOWN_PLACES.get((item.get("id"), cls._slugify(name)), {}),
          "visits": [
            {
              "id": uuid4().hex[:10],
              "label": label or name,
              "visitedOn": "",
              "dates": item.get("dates", ""),
              "travelers": item.get("travelers", 0),
              "days": item.get("days", 0),
              "tripMeta": item.get("tripMeta", ""),
              "story": item.get("story", ""),
              "reelUrl": item.get("reelUrl", ""),
              "photos": photos,
              "highlights": item.get("highlights") or [],
              "testimonials": item.get("testimonials") or [],
            }
          ],
        }
      )
    return out

  def _init_travel_gallery(self) -> None:
    coll = self.travel_gallery_collection
    if coll.count_documents({}) == 0:
      # Prefer admin-edited data from the old `travel_gallery` collection, else the bundled seed.
      legacy = list(self.db["travel_gallery"].find({})) if TRAVEL_GALLERY_COLLECTION != "travel_gallery" else []
      source = [{k: v for k, v in row.items() if k != "_id"} for row in legacy] or self._load_travel_gallery_seed()
      now = datetime.utcnow()
      docs = [{**self._legacy_state_to_places(item), "createdAt": now, "updatedAt": now} for item in source]
      if docs:
        coll.insert_many(docs)
        logger.info("Seeded %s travel gallery states into %s", len(docs), TRAVEL_GALLERY_COLLECTION)
      return

    # Collection already exists: convert any old-shape documents, add missing seed states, refresh map geometry only.
    now = datetime.utcnow()
    for row in list(coll.find({"places": {"$exists": False}})):
      converted = self._legacy_state_to_places({k: v for k, v in row.items() if k != "_id"})
      coll.update_one({"_id": row["_id"]}, {"$set": {**converted, "updatedAt": now}})
    self._assign_known_places(coll)
    for item in self._load_travel_gallery_seed():
      dest_id = str(item["id"])
      if coll.find_one({"id": dest_id}, {"_id": 1}):
        patch = {k: item[k] for k in ("mapPin", "svgStateId", "sortOrder") if k in item}
        coll.update_one({"id": dest_id}, {"$set": patch})
      else:
        coll.insert_one({**self._legacy_state_to_places(item), "createdAt": now, "updatedAt": now})

  # Places we already know about, so the first trip appears on the district map right away.
  _KNOWN_PLACES = {
    ("himachal", "jibhi"): {
      "districtId": "kullu", "districtName": "Kullu", "area": "Banjar Valley", "lat": 31.5985, "lng": 77.3476,
    },
    ("himachal", "spiti-valley"): {
      "districtId": "lahaul-and-spiti", "districtName": "Lahaul and Spiti", "area": "Spiti Valley", "lat": 32.2276, "lng": 78.0714,
    },
  }

  def _assign_known_places(self, coll: Collection) -> None:
    for (state_id, place_id), info in self._KNOWN_PLACES.items():
      row = coll.find_one({"id": state_id}, {"places": 1})
      if not row:
        continue
      places = row.get("places") or []
      changed = False
      for place in places:
        if place.get("id") == place_id and not place.get("districtId"):
          place.update(info)
          changed = True
      if changed:
        coll.update_one({"id": state_id}, {"$set": {"places": places}})

  @staticmethod
  def _strip_gallery_row(row: dict) -> dict:
    for key in ("_id", "createdAt", "updatedAt"):
      row.pop(key, None)
    return row

  @staticmethod
  def _with_legacy_fields(row: dict) -> dict:
    """Flatten all visits into the old single-trip fields so the current public page keeps working."""
    places = row.get("places") or []
    visits = [v for p in places for v in (p.get("visits") or [])]
    photos = [ph for v in visits for ph in (v.get("photos") or [])]
    latest = visits[0] if visits else {}
    row["photos"] = photos
    row["testimonials"] = [t for v in visits for t in (v.get("testimonials") or [])]
    row["highlights"] = [h for v in visits for h in (v.get("highlights") or [])]
    row["story"] = latest.get("story", "")
    row["dates"] = latest.get("dates", "")
    row["travelers"] = sum(int(v.get("travelers") or 0) for v in visits)
    row["days"] = latest.get("days", 0)
    row["reelUrl"] = latest.get("reelUrl", "")
    row["photoCountLabel"] = str(len(photos)) if photos else ""
    row["tripLabel"] = ", ".join(p.get("name", "") for p in places if p.get("name"))
    row["tripMeta"] = latest.get("tripMeta", "")
    if not row.get("heroImage"):
      row["heroImage"] = next((p.get("heroImage") for p in places if p.get("heroImage")), "") or (photos[0] if photos else "")
    return row

  @staticmethod
  def _sorted_visits(visits: List[dict]) -> List[dict]:
    # newest first; visits without visitedOn keep their order after dated ones
    return sorted(visits, key=lambda v: v.get("visitedOn") or "", reverse=True)

  def list_travel_gallery(self) -> List[dict]:
    rows = list(self.travel_gallery_collection.find({}).sort([("sortOrder", ASCENDING), ("state", ASCENDING)]))
    out: List[dict] = []
    for row in rows:
      self._strip_gallery_row(row)
      for place in row.get("places") or []:
        place["visits"] = self._sorted_visits(place.get("visits") or [])
      out.append(self._with_legacy_fields(row))
    return out

  def find_travel_gallery_by_id(self, dest_id: str) -> Optional[dict]:
    key = (dest_id or "").strip().lower()
    if not key:
      return None
    row = self.travel_gallery_collection.find_one({"id": key})
    if not row:
      return None
    self._strip_gallery_row(row)
    for place in row.get("places") or []:
      place["visits"] = self._sorted_visits(place.get("visits") or [])
    return self._with_legacy_fields(row)

  def _save_places(self, state_id: str, places: List[dict]) -> None:
    has_visits = any(p.get("visits") for p in places)
    update: Dict[str, Any] = {"places": places, "updatedAt": datetime.utcnow()}
    if has_visits:
      update["status"] = "completed"
    self.travel_gallery_collection.update_one({"id": state_id}, {"$set": update})

  def _load_places(self, state_id: str) -> Optional[List[dict]]:
    row = self.travel_gallery_collection.find_one({"id": (state_id or "").strip().lower()}, {"places": 1})
    if row is None:
      return None
    return list(row.get("places") or [])

  def create_gallery_state(self, fields: Dict[str, Any]) -> Optional[dict]:
    state = str(fields.get("state") or "").strip()
    state_id = self._slugify(fields.get("id") or state)
    if not state or not state_id:
      return None
    if self.travel_gallery_collection.find_one({"id": state_id}, {"_id": 1}):
      return None
    now = datetime.utcnow()
    last = self.travel_gallery_collection.find_one(sort=[("sortOrder", DESCENDING)], projection={"sortOrder": 1})
    doc = {
      "id": state_id,
      "state": state,
      "title": state,
      "svgStateId": fields.get("svgStateId") or "",
      "status": fields.get("status") or "coming_soon",
      "pinSubtitle": fields.get("pinSubtitle") or "Coming Soon",
      "heroImage": fields.get("heroImage") or "",
      "mapPin": fields.get("mapPin") or {"x": 306, "y": 348},
      "sortOrder": int((last or {}).get("sortOrder", 0)) + 1,
      "places": [],
      "createdAt": now,
      "updatedAt": now,
    }
    self.travel_gallery_collection.insert_one(doc)
    return self.find_travel_gallery_by_id(state_id)

  def update_gallery_state(self, state_id: str, fields: Dict[str, Any]) -> bool:
    allowed = {"state", "svgStateId", "status", "pinSubtitle", "heroImage", "mapPin"}
    update = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if "state" in update:
      update["title"] = update["state"]
    if not update:
      return self.find_travel_gallery_by_id(state_id) is not None
    update["updatedAt"] = datetime.utcnow()
    result = self.travel_gallery_collection.update_one({"id": (state_id or "").strip().lower()}, {"$set": update})
    return result.matched_count > 0

  def add_gallery_place(self, state_id: str, fields: Dict[str, Any]) -> Optional[dict]:
    places = self._load_places(state_id)
    if places is None:
      return None
    name = str(fields.get("name") or "").strip()
    base = self._slugify(name) or "place"
    taken = {p.get("id") for p in places}
    place_id, n = base, 2
    while place_id in taken:
      place_id, n = f"{base}-{n}", n + 1
    place = {
      "id": place_id,
      "name": name,
      "tagline": fields.get("tagline") or "",
      "description": fields.get("description") or "",
      "heroImage": fields.get("heroImage") or "",
      "districtId": fields.get("districtId") or "",
      "districtName": fields.get("districtName") or "",
      "area": fields.get("area") or "",
      "visits": [],
    }
    for key in ("lat", "lng", "mapPin"):
      if fields.get(key) is not None:
        place[key] = fields[key]
    places.append(place)
    self._save_places(state_id.strip().lower(), places)
    return place

  def update_gallery_place(self, state_id: str, place_id: str, fields: Dict[str, Any]) -> bool:
    places = self._load_places(state_id)
    if places is None:
      return False
    for place in places:
      if place.get("id") == place_id:
        for key in ("name", "tagline", "description", "heroImage", "mapPin", "districtId", "districtName", "area", "lat", "lng"):
          if key in fields and fields[key] is not None:
            place[key] = fields[key]
        self._save_places(state_id.strip().lower(), places)
        return True
    return False

  def delete_gallery_place(self, state_id: str, place_id: str) -> bool:
    places = self._load_places(state_id)
    if places is None:
      return False
    kept = [p for p in places if p.get("id") != place_id]
    if len(kept) == len(places):
      return False
    self._save_places(state_id.strip().lower(), kept)
    return True

  def add_gallery_visit(self, state_id: str, place_id: str, fields: Dict[str, Any]) -> Optional[dict]:
    places = self._load_places(state_id)
    if places is None:
      return None
    for place in places:
      if place.get("id") == place_id:
        visit = {
          "id": uuid4().hex[:10],
          "label": "",
          "visitedOn": "",
          "startDate": "",
          "endDate": "",
          "dates": "",
          "travelers": 0,
          "days": 0,
          "tripMeta": "",
          "story": "",
          "reelUrl": "",
          "photos": [],
          "highlights": [],
          "testimonials": [],
        }
        visit.update({k: v for k, v in fields.items() if k in visit and k != "id" and v is not None})
        place.setdefault("visits", []).append(visit)
        if not place.get("heroImage") and visit["photos"]:
          place["heroImage"] = visit["photos"][0]
        self._save_places(state_id.strip().lower(), places)
        return visit
    return None

  def update_gallery_visit(self, state_id: str, place_id: str, visit_id: str, fields: Dict[str, Any]) -> bool:
    places = self._load_places(state_id)
    if places is None:
      return False
    allowed = {"label", "visitedOn", "startDate", "endDate", "dates", "travelers", "days", "tripMeta", "story", "reelUrl", "photos", "highlights", "testimonials"}
    for place in places:
      if place.get("id") != place_id:
        continue
      for visit in place.get("visits") or []:
        if visit.get("id") == visit_id:
          visit.update({k: v for k, v in fields.items() if k in allowed and v is not None})
          if not place.get("heroImage") and visit.get("photos"):
            place["heroImage"] = visit["photos"][0]
          self._save_places(state_id.strip().lower(), places)
          return True
    return False

  def delete_gallery_visit(self, state_id: str, place_id: str, visit_id: str) -> bool:
    places = self._load_places(state_id)
    if places is None:
      return False
    for place in places:
      if place.get("id") != place_id:
        continue
      visits = place.get("visits") or []
      kept = [v for v in visits if v.get("id") != visit_id]
      if len(kept) == len(visits):
        return False
      place["visits"] = kept
      self._save_places(state_id.strip().lower(), places)
      return True
    return False

  def append_gallery_visit_photos(self, state_id: str, place_id: str, visit_id: str, paths: List[str]) -> bool:
    places = self._load_places(state_id)
    if places is None:
      return False
    for place in places:
      if place.get("id") != place_id:
        continue
      for visit in place.get("visits") or []:
        if visit.get("id") == visit_id:
          visit["photos"] = [*(visit.get("photos") or []), *paths]
          if not place.get("heroImage") and visit["photos"]:
            place["heroImage"] = visit["photos"][0]
          self._save_places(state_id.strip().lower(), places)
          return True
    return False


mongo_service = MongoService()
