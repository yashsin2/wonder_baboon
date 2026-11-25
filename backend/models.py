import re
from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from auth_utils import normalize_indian_mobile, sanitize_text

TripStyleSlug = Literal["backpackers", "motorcycle_diaries", "dolce_far_niente", "hikers"]
TRIP_STYLE_SLUGS = frozenset({"backpackers", "motorcycle_diaries", "dolce_far_niente", "hikers"})


class UserSignupRequest(BaseModel):
  name: str = Field(min_length=2, max_length=60)
  email: EmailStr
  mobile: str = Field(min_length=1, max_length=20)
  password: str = Field(min_length=8, max_length=72)

  @field_validator("email", mode="before")
  @classmethod
  def email_required_nonempty(cls, value: object) -> object:
    if value is None:
      raise ValueError("email is required")
    if isinstance(value, str) and not value.strip():
      raise ValueError("email is required")
    return value

  @field_validator("name")
  @classmethod
  def validate_name(cls, value: str) -> str:
    cleaned = sanitize_text(value, "name")
    if not re.fullmatch(r"[A-Za-z ]+", cleaned):
      raise ValueError("name must have letters and spaces only")
    return cleaned

  @field_validator("mobile", mode="before")
  @classmethod
  def normalize_mobile(cls, value: object) -> str:
    if value is None:
      raise ValueError("please enter a valid mobile number")
    return normalize_indian_mobile(str(value))

  @field_validator("password")
  @classmethod
  def validate_password(cls, value: str) -> str:
    if not (re.search(r"[A-Z]", value) and re.search(r"[a-z]", value) and re.search(r"\d", value)):
      raise ValueError("password must include uppercase lowercase number")
    return value


class UnifiedLoginRequest(BaseModel):
  identifier: str = Field(min_length=3, max_length=120)
  password: str = Field(min_length=8, max_length=72)

  @field_validator("identifier")
  @classmethod
  def validate_identifier(cls, value: str) -> str:
    return value.strip()


class TravelerContact(BaseModel):
  """An additional traveler on a booking. Mobile + email let them see the trip when they log in."""

  name: str = Field(min_length=2, max_length=60)
  mobile: str = Field(min_length=1, max_length=20)
  email: EmailStr

  @field_validator("name")
  @classmethod
  def validate_name(cls, value: str) -> str:
    return sanitize_text(value, "full_name")

  @field_validator("mobile", mode="before")
  @classmethod
  def normalize_mobile(cls, value: object) -> str:
    if value is None:
      raise ValueError("please enter a valid mobile number for each traveler")
    return normalize_indian_mobile(str(value))

  @field_validator("email", mode="after")
  @classmethod
  def lower_email(cls, value: str) -> str:
    return str(value).strip().lower()


class GuestBookingRequest(BaseModel):
  trip_id: str = Field(min_length=2)
  travel_destination: str = Field(min_length=3, max_length=120)
  date_of_travel: str
  full_name: str = Field(min_length=2, max_length=60)
  mobile: str = Field(min_length=1, max_length=20)
  email: Optional[EmailStr] = None
  number_of_people: int = Field(ge=1, le=20, default=1)
  additional_travelers: List[str] = Field(default_factory=list, max_length=19)
  additional_contacts: List[TravelerContact] = Field(default_factory=list, max_length=19)

  @field_validator("additional_travelers", mode="before")
  @classmethod
  def coerce_guest_extras(cls, value: object) -> List[str]:
    if value is None:
      return []
    if not isinstance(value, list):
      return []
    return [str(x).strip() for x in value if str(x).strip()]

  @field_validator("additional_travelers")
  @classmethod
  def sanitize_guest_extras(cls, value: List[str]) -> List[str]:
    return [sanitize_text(item, "full_name") for item in value[:19]]

  @model_validator(mode="after")
  def guest_extras_match_people(self) -> "GuestBookingRequest":
    need = self.number_of_people - 1
    if len(self.additional_contacts) != need:
      raise ValueError(
        f"When booking for {self.number_of_people} people, enter name, mobile and email "
        f"for each of the {need} additional traveler(s)."
      )
    self.additional_travelers = [c.name for c in self.additional_contacts]
    return self

  @field_validator("trip_id", "travel_destination", "full_name")
  @classmethod
  def validate_text_fields(cls, value: str) -> str:
    return sanitize_text(value)

  @field_validator("mobile", mode="before")
  @classmethod
  def normalize_mobile(cls, value: object) -> str:
    if value is None:
      raise ValueError("please enter a valid mobile number")
    return normalize_indian_mobile(str(value))

  @field_validator("date_of_travel")
  @classmethod
  def validate_date(cls, value: str) -> str:
    trip_date = datetime.strptime(value, "%Y-%m-%d").date()
    if trip_date < datetime.now().date():
      raise ValueError("date of travel cannot be in the past")
    return value


class PlannedTripRequest(BaseModel):
  travel_destination: str = Field(min_length=3, max_length=120)
  date_of_travel: str
  full_name: str = Field(min_length=2, max_length=60)
  mobile: str = Field(min_length=1, max_length=20)
  email: Optional[EmailStr] = None
  number_of_people: int = Field(ge=1, le=20, default=1)
  additional_travelers: List[str] = Field(default_factory=list, max_length=19)

  @field_validator("additional_travelers", mode="before")
  @classmethod
  def coerce_additional_travelers(cls, value: object) -> List[str]:
    if value is None:
      return []
    if not isinstance(value, list):
      return []
    return [str(x).strip() for x in value if str(x).strip()]

  @field_validator("additional_travelers")
  @classmethod
  def validate_additional_travelers_planned(cls, value: List[str]) -> List[str]:
    return [sanitize_text(item, "full_name") for item in value[:19]]

  @model_validator(mode="after")
  def match_people_count_planned(self) -> "PlannedTripRequest":
    need = self.number_of_people - 1
    if len(self.additional_travelers) != need:
      raise ValueError(
        f"When booking for {self.number_of_people} people, enter {need} additional traveler name(s)."
      )
    return self

  @field_validator("travel_destination", "full_name")
  @classmethod
  def validate_text_fields(cls, value: str) -> str:
    return sanitize_text(value)

  @field_validator("mobile", mode="before")
  @classmethod
  def normalize_mobile(cls, value: object) -> str:
    if value is None:
      raise ValueError("please enter a valid mobile number")
    return normalize_indian_mobile(str(value))

  @field_validator("date_of_travel")
  @classmethod
  def validate_date(cls, value: str) -> str:
    trip_date = datetime.strptime(value, "%Y-%m-%d").date()
    if trip_date < datetime.now().date():
      raise ValueError("date of travel cannot be in the past")
    return value


class ProfileNameUpdateRequest(BaseModel):
  name: str = Field(min_length=2, max_length=60)

  @field_validator("name")
  @classmethod
  def validate_name(cls, value: str) -> str:
    cleaned = sanitize_text(value, "name")
    if not re.fullmatch(r"[A-Za-z ]+", cleaned):
      raise ValueError("name must have letters and spaces only")
    return cleaned


class EmailOtpRequest(BaseModel):
  new_email: EmailStr


class MobileOtpRequest(BaseModel):
  new_mobile: str = Field(min_length=1, max_length=20)

  @field_validator("new_mobile", mode="before")
  @classmethod
  def normalize_new_mobile(cls, value: object) -> str:
    if value is None:
      raise ValueError("please enter a valid mobile number")
    return normalize_indian_mobile(str(value))


class OtpVerifyRequest(BaseModel):
  code: str = Field(min_length=4, max_length=10)

  @field_validator("code")
  @classmethod
  def validate_code(cls, value: str) -> str:
    cleaned = value.strip()
    if not cleaned.isdigit():
      raise ValueError("code must be digits")
    return cleaned


class AdminConfirmPaymentFields(BaseModel):
  """advance received + optional package override (planned trips or missing catalogue trip)."""

  advance_payment_inr: int = Field(ge=0, le=99_999_999)
  trip_total_inr: Optional[int] = Field(
    default=None,
    ge=1,
    le=99_999_999,
    description="Required for planned packages; ignored for catalogue trips when price is resolved.",
  )

  @field_validator("advance_payment_inr", "trip_total_inr", mode="before")
  @classmethod
  def coerce_int_optional(cls, value: object) -> object:
    if value is None:
      return None
    if isinstance(value, bool):
      raise ValueError("invalid amount")
    if isinstance(value, int):
      return value
    if isinstance(value, float):
      if value != int(value):
        raise ValueError("amount must be a whole number (rupees)")
      return int(value)
    if isinstance(value, str):
      s = value.strip().replace(",", "")
      if not s:
        raise ValueError("invalid amount")
      return int(s)
    raise ValueError("invalid amount")


class AdminConfirmBookingRequest(AdminConfirmPaymentFields):
  booking_id: str = Field(min_length=1, max_length=64)

  @field_validator("booking_id")
  @classmethod
  def strip_booking_id(cls, value: str) -> str:
    return value.strip()


PaymentKind = Literal["advance", "full"]


class RazorpayCreateOrderRequest(BaseModel):
  booking_id: Optional[str] = Field(default=None, max_length=64)
  pending_token: Optional[str] = Field(default=None, max_length=8192)
  payment_kind: PaymentKind = "advance"

  @field_validator("booking_id")
  @classmethod
  def strip_booking_id(cls, value: Optional[str]) -> Optional[str]:
    if value is None:
      return None
    stripped = value.strip()
    return stripped or None

  @field_validator("pending_token")
  @classmethod
  def strip_pending_token(cls, value: Optional[str]) -> Optional[str]:
    if value is None:
      return None
    stripped = value.strip()
    return stripped or None

  @model_validator(mode="after")
  def require_booking_ref(self) -> "RazorpayCreateOrderRequest":
    has_id = bool(self.booking_id)
    has_token = bool(self.pending_token)
    if has_id == has_token:
      raise ValueError("provide exactly one of booking_id or pending_token")
    return self


class RazorpayVerifyRequest(BaseModel):
  booking_id: Optional[str] = Field(default=None, max_length=64)
  pending_token: Optional[str] = Field(default=None, max_length=8192)
  payment_kind: PaymentKind = "advance"
  razorpay_order_id: str = Field(min_length=1, max_length=128)
  razorpay_payment_id: str = Field(min_length=1, max_length=128)
  razorpay_signature: str = Field(min_length=1, max_length=256)

  @field_validator("booking_id")
  @classmethod
  def strip_booking_id(cls, value: Optional[str]) -> Optional[str]:
    if value is None:
      return None
    stripped = value.strip()
    return stripped or None

  @field_validator("pending_token")
  @classmethod
  def strip_pending_token(cls, value: Optional[str]) -> Optional[str]:
    if value is None:
      return None
    stripped = value.strip()
    return stripped or None

  @model_validator(mode="after")
  def require_booking_ref(self) -> "RazorpayVerifyRequest":
    has_id = bool(self.booking_id)
    has_token = bool(self.pending_token)
    if has_id == has_token:
      raise ValueError("provide exactly one of booking_id or pending_token")
    return self


class AdminMarkFullPaymentRequest(BaseModel):
  booking_id: str = Field(min_length=1, max_length=64)

  @field_validator("booking_id")
  @classmethod
  def strip_booking_id(cls, value: str) -> str:
    return value.strip()


class AddMembersRequest(BaseModel):
  additional_contacts: List[TravelerContact] = Field(min_length=1, max_length=19)

  @property
  def additional_travelers(self) -> List[str]:
    return [c.name for c in self.additional_contacts]


class AdminTripCreateRequest(BaseModel):
  title: str = Field(min_length=3, max_length=120)
  location: str = Field(min_length=2, max_length=80)
  duration_label: str = Field(min_length=2, max_length=30)
  price: int = Field(ge=0, le=200000)
  start_date: str
  end_date: str
  image_name: str = Field(min_length=3, max_length=120)
  published: bool = True
  trip_style: TripStyleSlug = "backpackers"

  @field_validator("title", "location", "duration_label", "image_name")
  @classmethod
  def validate_text_fields(cls, value: str) -> str:
    return sanitize_text(value)

  @field_validator("start_date", "end_date")
  @classmethod
  def validate_date(cls, value: str) -> str:
    datetime.strptime(value, "%Y-%m-%d")
    return value

  @model_validator(mode="after")
  def dates_make_sense(self) -> "AdminTripCreateRequest":
    start = datetime.strptime(self.start_date, "%Y-%m-%d").date()
    end = datetime.strptime(self.end_date, "%Y-%m-%d").date()
    if start < datetime.now().date():
      raise ValueError("start date cannot be in the past")
    if end < start:
      raise ValueError("end date cannot be before the start date")
    return self


class AdminTripUpdateRequest(BaseModel):
  title: Optional[str] = Field(default=None, min_length=3, max_length=120)
  location: Optional[str] = Field(default=None, min_length=2, max_length=80)
  duration_label: Optional[str] = Field(default=None, min_length=2, max_length=30)
  price: Optional[int] = Field(default=None, ge=0, le=200000)
  start_date: Optional[str] = None
  end_date: Optional[str] = None
  image_name: Optional[str] = Field(default=None, min_length=3, max_length=120)
  published: Optional[bool] = None
  trip_style: Optional[TripStyleSlug] = None

  @field_validator("title", "location", "duration_label", "image_name")
  @classmethod
  def validate_optional_text(cls, value: Optional[str]) -> Optional[str]:
    if value is None:
      return None
    return sanitize_text(value)

  @field_validator("start_date", "end_date")
  @classmethod
  def validate_optional_date(cls, value: Optional[str]) -> Optional[str]:
    if value is None:
      return None
    datetime.strptime(value, "%Y-%m-%d")
    return value

  @model_validator(mode="after")
  def at_least_one_field(self) -> "AdminTripUpdateRequest":
    data = self.model_dump(exclude_unset=True)
    if not data:
      raise ValueError("submit at least one field to update")
    if self.start_date and self.end_date and self.end_date < self.start_date:
      raise ValueError("end date cannot be before the start date")
    return self


GalleryStatus = Literal["completed", "coming_soon"]


def _gallery_text(value: Optional[str]) -> Optional[str]:
  """Light sanitiser for gallery copy: strips tags/script, but allows normal words like 'Selected'."""
  if value is None:
    return None
  cleaned = value.strip()
  if re.search(r"(<|>|javascript:)", cleaned, re.IGNORECASE):
    raise ValueError("text contains invalid content")
  return cleaned


def _gallery_paths(value: Optional[List[str]]) -> Optional[List[str]]:
  if value is None:
    return None
  out: List[str] = []
  for item in value:
    path = str(item).strip()
    if path and path not in out and not re.search(r"(<|>|javascript:)", path, re.IGNORECASE):
      out.append(path[:300])
  return out[:400]


class TravelGalleryTestimonial(BaseModel):
  name: str = Field(min_length=1, max_length=80)
  quote: str = Field(min_length=3, max_length=5000)
  avatar: Optional[str] = Field(default=None, max_length=240)

  @field_validator("name", "quote")
  @classmethod
  def validate_text(cls, value: str) -> str:
    return _gallery_text(value) or ""


class TravelGalleryHighlight(BaseModel):
  title: str = Field(min_length=1, max_length=120)
  image: str = Field(min_length=3, max_length=300)

  @field_validator("title", "image")
  @classmethod
  def validate_text(cls, value: str) -> str:
    return _gallery_text(value) or ""


class _GalleryBase(BaseModel):
  @model_validator(mode="after")
  def at_least_one_field(self):
    if not self.model_dump(exclude_unset=True):
      raise ValueError("submit at least one field to update")
    return self


class TravelGalleryStateRequest(_GalleryBase):
  """A state on the India map (e.g. Himachal Pradesh)."""

  id: Optional[str] = Field(default=None, max_length=40)
  state: Optional[str] = Field(default=None, min_length=2, max_length=80)
  svgStateId: Optional[str] = Field(default=None, max_length=8)
  status: Optional[GalleryStatus] = None
  pinSubtitle: Optional[str] = Field(default=None, max_length=60)
  heroImage: Optional[str] = Field(default=None, max_length=300)
  mapPin: Optional[Dict[str, float]] = None

  @field_validator("state", "pinSubtitle", "heroImage", "svgStateId")
  @classmethod
  def validate_text(cls, value: Optional[str]) -> Optional[str]:
    return _gallery_text(value)


class TravelGalleryPlaceRequest(_GalleryBase):
  """A place inside a state (e.g. Jibhi, Spiti)."""

  name: Optional[str] = Field(default=None, min_length=2, max_length=80)
  tagline: Optional[str] = Field(default=None, max_length=160)
  description: Optional[str] = Field(default=None, max_length=1500)
  heroImage: Optional[str] = Field(default=None, max_length=300)
  mapPin: Optional[Dict[str, float]] = None
  # where it is: district (id from assets/maps/manifest.json), a sub-area like "Banjar Valley", and the pin
  districtId: Optional[str] = Field(default=None, max_length=60)
  districtName: Optional[str] = Field(default=None, max_length=80)
  area: Optional[str] = Field(default=None, max_length=80)
  lat: Optional[float] = Field(default=None, ge=6.0, le=38.5)
  lng: Optional[float] = Field(default=None, ge=67.0, le=98.5)

  @field_validator("name", "tagline", "description", "heroImage", "districtName", "area")
  @classmethod
  def validate_text(cls, value: Optional[str]) -> Optional[str]:
    return _gallery_text(value)

  @field_validator("districtId")
  @classmethod
  def validate_district_id(cls, value: Optional[str]) -> Optional[str]:
    if value is None:
      return None
    cleaned = value.strip().lower()
    if cleaned and not re.fullmatch(r"[a-z0-9-]{1,60}", cleaned):
      raise ValueError("invalid district id")
    return cleaned


class TravelGalleryVisitRequest(_GalleryBase):
  """One trip to a place. A place can have many visits over the years."""

  label: Optional[str] = Field(default=None, max_length=120)
  visitedOn: Optional[str] = Field(default=None, max_length=10)  # YYYY-MM or YYYY-MM-DD, used for ordering
  startDate: Optional[str] = Field(default=None, max_length=10)  # YYYY-MM-DD
  endDate: Optional[str] = Field(default=None, max_length=10)  # YYYY-MM-DD, never before startDate
  dates: Optional[str] = Field(default=None, max_length=80)
  travelers: Optional[int] = Field(default=None, ge=0, le=500)
  days: Optional[int] = Field(default=None, ge=0, le=90)
  tripMeta: Optional[str] = Field(default=None, max_length=240)
  story: Optional[str] = Field(default=None, max_length=1500)
  reelUrl: Optional[str] = Field(default=None, max_length=500)
  photos: Optional[List[str]] = None
  testimonials: Optional[List[TravelGalleryTestimonial]] = None
  highlights: Optional[List[TravelGalleryHighlight]] = None

  @field_validator("label", "dates", "tripMeta", "story", "reelUrl")
  @classmethod
  def validate_text(cls, value: Optional[str]) -> Optional[str]:
    return _gallery_text(value)

  @field_validator("reelUrl")
  @classmethod
  def validate_reel_url(cls, value: Optional[str]) -> Optional[str]:
    # Rendered as a link on the public site: only real web links, never javascript:/data: URLs.
    if value and not re.match(r"^https?://", value.strip(), re.I):
      raise ValueError("reel link must start with http:// or https://")
    return value

  @field_validator("visitedOn")
  @classmethod
  def validate_visited_on(cls, value: Optional[str]) -> Optional[str]:
    if value is None or not value.strip():
      return ""
    cleaned = value.strip()
    if not re.fullmatch(r"\d{4}-\d{2}(-\d{2})?", cleaned):
      raise ValueError("visitedOn must look like 2026-06 or 2026-06-18")
    return cleaned

  @field_validator("startDate", "endDate")
  @classmethod
  def validate_iso_day(cls, value: Optional[str]) -> Optional[str]:
    if value is None or not value.strip():
      return ""
    cleaned = value.strip()
    datetime.strptime(cleaned, "%Y-%m-%d")
    return cleaned

  @model_validator(mode="after")
  def end_not_before_start(self) -> "TravelGalleryVisitRequest":
    if self.startDate and self.endDate and self.endDate < self.startDate:
      raise ValueError("end date cannot be before the start date")
    return self

  @field_validator("photos")
  @classmethod
  def validate_photos(cls, value: Optional[List[str]]) -> Optional[List[str]]:
    return _gallery_paths(value)


BLOG_MOODS = ("Emotional", "Funny", "Adventure", "Food", "Soul-searching", "Budget tips")
_HTML_TAG = re.compile(r"<[^>]*>|<|>")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_blog_text(value: str, field: str, min_len: int, max_len: int, multiline: bool = False) -> str:
  """Blog prose may contain ordinary words like 'select' or 'delete', so it skips sanitize_text."""
  text = _CONTROL_CHARS.sub("", value or "").replace("\r\n", "\n").strip()
  if not multiline:
    text = re.sub(r"\s+", " ", text)
  if _HTML_TAG.search(text):
    raise ValueError(f"{field} cannot contain HTML or angle brackets")
  if len(text) < min_len:
    raise ValueError(f"{field} must be at least {min_len} characters")
  if len(text) > max_len:
    raise ValueError(f"{field} must be at most {max_len} characters")
  return text


class BlogImage(BaseModel):
  full: str = Field(min_length=1, max_length=500)
  thumb: str = Field(min_length=1, max_length=500)
  w: int = Field(ge=1, le=10000)
  h: int = Field(ge=1, le=10000)
  caption: str = Field(default="", max_length=140)

  @field_validator("caption")
  @classmethod
  def validate_caption(cls, value: str) -> str:
    return clean_blog_text(value, "caption", 0, 140) if value else ""


class BlogDiscardUploadRequest(BaseModel):
  full: str = Field(min_length=1, max_length=500)
  thumb: str = Field(min_length=1, max_length=500)


class BlogPostRequest(BaseModel):
  title: str
  body: str
  mood: str
  place: str = ""
  images: List[BlogImage] = Field(default_factory=list, max_length=6)

  @field_validator("title")
  @classmethod
  def validate_title(cls, value: str) -> str:
    return clean_blog_text(value, "title", 4, 120)

  @field_validator("body")
  @classmethod
  def validate_body(cls, value: str) -> str:
    return clean_blog_text(value, "story", 50, 10000, multiline=True)

  @field_validator("mood")
  @classmethod
  def validate_mood(cls, value: str) -> str:
    if value not in BLOG_MOODS:
      raise ValueError("pick a mood from the list")
    return value

  @field_validator("place")
  @classmethod
  def validate_place(cls, value: str) -> str:
    return clean_blog_text(value, "place", 0, 80) if value else ""


class BlogCommentRequest(BaseModel):
  body: str
  parentId: Optional[str] = None

  @field_validator("body")
  @classmethod
  def validate_body(cls, value: str) -> str:
    return clean_blog_text(value, "comment", 1, 1000, multiline=True)


class BlogReportRequest(BaseModel):
  reason: str = ""

  @field_validator("reason")
  @classmethod
  def validate_reason(cls, value: str) -> str:
    return clean_blog_text(value, "reason", 0, 200) if value else ""


class BlogModerateRequest(BaseModel):
  status: Literal["published", "hidden", "deleted"]
