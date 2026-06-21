import logging
import threading
import time
from datetime import date, datetime
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

from config import TRIP_COMPLETION_CHECK_INTERVAL_SECONDS
from services.email_service import email_service
from services.mongo_service import mongo_service

logger = logging.getLogger(__name__)
_IST = ZoneInfo("Asia/Kolkata")


def _parse_iso_date(raw: str) -> Optional[date]:
  s = (raw or "").strip()
  if not s:
    return None
  try:
    return datetime.strptime(s[:10], "%Y-%m-%d").date()
  except ValueError:
    return None


def _format_human(d: date) -> str:
  return f"{d.day} {d.strftime('%b %Y')}"


def _linked_trip(booking: Dict[str, Any]) -> Optional[dict]:
  trip_id = booking.get("tripId")
  if not trip_id:
    return None
  return mongo_service.find_trip_by_id(str(trip_id))


def booking_trip_start_date(booking: Dict[str, Any]) -> Optional[date]:
  trip = _linked_trip(booking)
  if trip:
    for key in ("startDate", "endDate"):
      parsed = _parse_iso_date(str(trip.get(key) or ""))
      if parsed:
        return parsed
  return _parse_iso_date(str(booking.get("dateOfTravel") or ""))


def booking_trip_end_date(booking: Dict[str, Any]) -> Optional[date]:
  trip = _linked_trip(booking)
  if trip:
    for key in ("endDate", "startDate"):
      parsed = _parse_iso_date(str(trip.get(key) or ""))
      if parsed:
        return parsed
  return _parse_iso_date(str(booking.get("dateOfTravel") or ""))


def booking_travel_window_label(booking: Dict[str, Any]) -> str:
  start = booking_trip_start_date(booking)
  end = booking_trip_end_date(booking)
  if start and end and start != end:
    if start.year == end.year:
      return f"{start.day} {start.strftime('%b')} – {_format_human(end)}"
    return f"{_format_human(start)} – {_format_human(end)}"
  if end:
    return _format_human(end)
  if start:
    return _format_human(start)
  return "—"


def _package_total_for_completion(booking: Dict[str, Any]) -> int:
  stored = booking.get("packageTotalInr")
  if stored is not None:
    try:
      total = int(stored)
      if total > 0:
        return total
    except (TypeError, ValueError):
      pass
  estimate = mongo_service.package_total_inr_for_booking(booking, None)
  return max(0, int(estimate or 0))


def _traveler_inbox(booking: Dict[str, Any]) -> str:
  raw = booking.get("email")
  if raw is None:
    return ""
  s = str(raw).strip().lower()
  return s if s and "@" in s else ""


def process_trip_completion_emails() -> int:
  """Send trip-completed emails for fully paid bookings past their end date."""
  if not mongo_service.is_connected():
    return 0

  today = datetime.now(_IST).date()
  bookings = mongo_service.list_paid_bookings_pending_completion_email()
  sent = 0

  for booking in bookings:
    end = booking_trip_end_date(booking)
    if not end or today <= end:
      continue

    inbox = _traveler_inbox(booking)
    if not inbox:
      logger.warning(
        "trip completion skipped booking=%s — no traveler email",
        booking.get("_id"),
      )
      continue

    package_total = _package_total_for_completion(booking)
    travel_window = booking_travel_window_label(booking)
    ok, err = email_service.notify_trip_completed_traveler(
      inbox,
      booking,
      package_total_inr=package_total,
      travel_window=travel_window,
    )
    if not ok:
      logger.error(
        "trip completion email failed booking=%s to=%s err=%s",
        booking.get("_id"),
        inbox,
        err,
      )
      continue

    booking_id = str(booking.get("_id") or "")
    if mongo_service.mark_completion_email_sent(booking_id):
      sent += 1
      logger.info("trip completion email sent booking=%s to=%s", booking_id, inbox)
    else:
      logger.warning(
        "trip completion email sent but mark failed booking=%s (may retry)",
        booking_id,
      )

  return sent


def sample_trip_completed_booking() -> Dict[str, Any]:
  """Sample payload for admin test sends."""
  return {
    "_id": "WB-SAMPLE-COMPLETE",
    "travelDestination": "Sojha, Jibhi",
    "dateOfTravel": "2026-08-21",
    "fullName": "Yashvardhan",
    "numberOfPeople": 2,
    "packageTotalInr": 15998,
  }


def send_test_trip_completed_email(to: str) -> tuple[bool, Optional[str]]:
  sample = sample_trip_completed_booking()
  return email_service.notify_trip_completed_traveler(
    to,
    sample,
    package_total_inr=int(sample["packageTotalInr"]),
    travel_window="21 Aug – 24 Aug 2026",
  )


def start_trip_completion_worker() -> None:
  """Background loop — checks hourly (configurable) for trips that ended."""

  def loop() -> None:
    time.sleep(30)
    while True:
      try:
        if mongo_service.is_connected():
          count = process_trip_completion_emails()
          if count:
            logger.info("trip completion worker sent %s email(s)", count)
      except Exception:
        logger.exception("trip completion worker error")
      time.sleep(max(300, TRIP_COMPLETION_CHECK_INTERVAL_SECONDS))

  threading.Thread(target=loop, daemon=True, name="trip-completion-email").start()
  logger.info(
    "trip completion email worker started (interval=%ss)",
    TRIP_COMPLETION_CHECK_INTERVAL_SECONDS,
  )
