import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from auth_utils import sanitize_text


class UserSignupRequest(BaseModel):
  name: str = Field(min_length=2, max_length=60)
  email: EmailStr
  mobile: str = Field(min_length=10, max_length=15)
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

  @field_validator("mobile")
  @classmethod
  def validate_mobile(cls, value: str) -> str:
    mobile = value.strip()
    if not re.fullmatch(r"^[6-9]\d{9,14}$", mobile):
      raise ValueError("invalid mobile number")
    return mobile

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


class GuestBookingRequest(BaseModel):
  trip_id: str = Field(min_length=2)
  travel_destination: str = Field(min_length=3, max_length=120)
  date_of_travel: str
  full_name: str = Field(min_length=2, max_length=60)
  mobile: str = Field(min_length=10, max_length=15)
  email: Optional[EmailStr] = None
  number_of_people: int = Field(ge=1, le=20, default=1)
  additional_travelers: List[str] = Field(default_factory=list, max_length=19)

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
    if len(self.additional_travelers) != need:
      raise ValueError(
        f"When booking for {self.number_of_people} people, enter {need} additional traveler name(s) "
        "(full name for each extra person)."
      )
    return self

  @field_validator("trip_id", "travel_destination", "full_name")
  @classmethod
  def validate_text_fields(cls, value: str) -> str:
    return sanitize_text(value)

  @field_validator("mobile")
  @classmethod
  def validate_mobile(cls, value: str) -> str:
    mobile = value.strip()
    if not re.fullmatch(r"^[6-9]\d{9,14}$", mobile):
      raise ValueError("invalid mobile number")
    return mobile

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
  mobile: str = Field(min_length=10, max_length=15)
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

  @field_validator("mobile")
  @classmethod
  def validate_mobile(cls, value: str) -> str:
    mobile = value.strip()
    if not re.fullmatch(r"^[6-9]\d{9,14}$", mobile):
      raise ValueError("invalid mobile number")
    return mobile

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
  new_mobile: str = Field(min_length=10, max_length=15)

  @field_validator("new_mobile")
  @classmethod
  def validate_mobile(cls, value: str) -> str:
    mobile = value.strip()
    if not re.fullmatch(r"^[6-9]\d{9,14}$", mobile):
      raise ValueError("invalid mobile number")
    return mobile


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


class AdminTripCreateRequest(BaseModel):
  title: str = Field(min_length=3, max_length=120)
  location: str = Field(min_length=2, max_length=80)
  duration_label: str = Field(min_length=2, max_length=30)
  price: int = Field(ge=0, le=200000)
  start_date: str
  end_date: str
  image_name: str = Field(min_length=3, max_length=120)
  published: bool = True

  @field_validator("title", "location", "duration_label", "image_name")
  @classmethod
  def validate_text_fields(cls, value: str) -> str:
    return sanitize_text(value)

  @field_validator("start_date", "end_date")
  @classmethod
  def validate_date(cls, value: str) -> str:
    datetime.strptime(value, "%Y-%m-%d")
    return value


class AdminTripUpdateRequest(BaseModel):
  title: Optional[str] = Field(default=None, min_length=3, max_length=120)
  location: Optional[str] = Field(default=None, min_length=2, max_length=80)
  duration_label: Optional[str] = Field(default=None, min_length=2, max_length=30)
  price: Optional[int] = Field(default=None, ge=0, le=200000)
  start_date: Optional[str] = None
  end_date: Optional[str] = None
  image_name: Optional[str] = Field(default=None, min_length=3, max_length=120)
  published: Optional[bool] = None

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
    return self
