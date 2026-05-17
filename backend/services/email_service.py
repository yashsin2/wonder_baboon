import logging
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Any, Dict, Optional, Tuple

from config import (
  BOOKING_NOTIFY_EMAIL,
  IS_PRODUCTION,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASSWORD,
  SMTP_PORT,
  SMTP_USE_TLS,
  SMTP_USER,
)

logger = logging.getLogger(__name__)


class EmailService:
  @property
  def is_configured(self) -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

  def send(self, to: str, subject: str, body: str) -> Tuple[bool, Optional[str]]:
    """Returns (success, user_safe_error_message_if_failed)."""
    if not self.is_configured:
      if IS_PRODUCTION:
        logger.error("SMTP not configured in production; cannot send email to %s", to)
        return False, "email is not configured on the server"
      logger.warning("[DEV] SMTP not configured. Email to %s — subject=%s\n%s", to, subject, body)
      return True, None

    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    try:
      if SMTP_USE_TLS:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
          server.starttls()
          server.login(SMTP_USER, SMTP_PASSWORD)
          server.send_message(msg)
      else:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15) as server:
          server.login(SMTP_USER, SMTP_PASSWORD)
          server.send_message(msg)
      logger.info("Email sent to %s (subject=%s)", to, subject)
      return True, None
    except smtplib.SMTPAuthenticationError as exc:
      logger.error("SMTP login rejected for user %s: %s", SMTP_USER, exc)
      hint = (
        "Gmail rejected the SMTP login (535). Use a Google App Password as SMTP_PASSWORD "
        "(Google Account → Security → 2-Step Verification → App passwords), not your normal Gmail password. "
        "SMTP_USER must be the same Gmail address."
      )
      return False, hint
    except Exception as exc:
      logger.exception("Failed to send email to %s: %s", to, exc)
      return False, "could not send email; check server logs or try again later"

  def notify_new_booking(self, doc: Dict[str, Any]) -> None:
    """Alert ops inbox when a booking is saved. Failures are logged only (booking already persisted)."""
    if not BOOKING_NOTIFY_EMAIL:
      return
    dest = str(doc.get("travelDestination") or "Trip")
    travel_date = str(doc.get("dateOfTravel") or "")
    subject = f"[Wonder Baboon] New booking — {dest} ({travel_date})"
    lines = [
      "A new booking was submitted on Wonder Baboon.",
      "",
      f"Booking ID:     {str(doc.get('_id')) if doc.get('_id') is not None else '—'}",
      f"Trip type:      {doc.get('tripType')}",
      f"Trip ID:        {doc.get('tripId', '—')}",
      f"Destination:    {doc.get('travelDestination')}",
      f"Travel date:    {doc.get('dateOfTravel')}",
      f"Full name:      {doc.get('fullName')}",
      f"Mobile:         {doc.get('mobile')}",
      f"Email:          {doc.get('email') or '—'}",
      f"People:         {doc.get('numberOfPeople')}",
      f"Payment:        {doc.get('payment')}",
      f"Source:         {doc.get('source')}",
    ]
    created = doc.get("createdAt")
    if isinstance(created, datetime):
      lines.append(f"Created:        {created.isoformat()}")
    elif created is not None:
      lines.append(f"Created:        {created}")
    body = "\n".join(lines)
    ok, err = self.send(BOOKING_NOTIFY_EMAIL, subject, body)
    if not ok:
      logger.error("Booking notify email failed: %s", err)


email_service = EmailService()
