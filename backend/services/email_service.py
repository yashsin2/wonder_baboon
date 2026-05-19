import html
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


def _inr(n: int) -> str:
  try:
    return f"₹{int(n):,}"
  except (TypeError, ValueError):
    return "₹—"


def _safe(s: Optional[str]) -> str:
  if s is None:
    return ""
  return html.escape(str(s))


def backpacker_confirmation_html(
  *,
  full_name: str,
  destination: str,
  travel_date: str,
  people_line: str,
  package_total_inr: int,
  advance_inr: int,
  balance_inr: int,
  booking_display_id: str,
) -> str:
  greeting = full_name.strip() if full_name else "Explorer"

  accent = "#c4621a"
  forest = "#1e3d2f"
  sand = "#f4ede3"
  return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width" />
<title>You’re booked</title></head>
<body style="margin:0;padding:0;background:#e8dfd0;font-family:'Segoe UI',Roboto,Georgia,ui-serif,sans-serif;color:#3d3428;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(160deg,#2d4a3a 0%,#c4621a 140%);padding:36px 12px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:{sand};border-radius:14px;overflow:hidden;box-shadow:0 18px 45px rgba(30,61,47,0.35);border:2px solid #d4cbb8;">
      <tr><td style="background:{forest};padding:26px 28px;color:#eef6f2;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.38em;text-transform:uppercase;opacity:0.92;">Trail note</p>
        <h1 style="margin:0;font-size:26px;line-height:1.15;font-weight:800;">Pack your sack — Wonder Baboon</h1>
        <p style="margin:12px 0 0;font-size:15px;opacity:0.95;">Your adventure wallet just got greener. Official confirmation below.</p>
      </td></tr>
      <tr><td style="padding:28px 26px;">
        <p style="margin:0 0 18px;font-size:17px;line-height:1.5;">Namaste, {_safe(greeting)},</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#4a4338;">
          We stamped your booking for <strong>{_safe(destination)}</strong>. Dust off those boots —
          {_safe(travel_date)} is on the compass.
        </p>
        <div style="margin:22px 0;padding:18px 16px;background:#faf6ef;border-radius:10px;border:1px dashed {accent};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="font-size:14px;color:#3d3428;">
            <tr><td style="opacity:0.75;">📍 Escape</td><td style="font-weight:700;text-align:right;">{_safe(destination)}</td></tr>
            <tr><td style="opacity:0.75;">📅 Roll-out</td><td style="font-weight:700;text-align:right;">{_safe(travel_date)}</td></tr>
            <tr><td style="opacity:0.75;">🥾 Tribe size</td><td style="font-weight:700;text-align:right;">{_safe(people_line)}</td></tr>
            <tr><td style="opacity:0.75;">📋 Reference</td><td style="font-family:monospace;text-align:right;">{_safe(booking_display_id)}</td></tr>
          </table>
        </div>
        <h2 style="margin:24px 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:0.2em;color:{forest};">Ledger on the ridge</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:10px;overflow:hidden;border:1px solid #dce3d9;">
          <tr style="background:{forest};color:#eef6f2;"><td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;">Your backpacking math</td></tr>
          <tr><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#ffffff;">Estimated package total (per-person rate × hikers)</td><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#ffffff;text-align:right;font-weight:800;color:{forest};">{_inr(package_total_inr)}</td></tr>
          <tr><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#fafafa;">Advance received ✓</td><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#fafafa;text-align:right;font-weight:800;color:#166534;">− {_inr(advance_inr)}</td></tr>
          <tr><td style="padding:14px 16px;background:{sand};font-weight:800;">Balance due before wheels up</td><td style="padding:14px 16px;background:{sand};text-align:right;font-weight:900;font-size:18px;color:{accent};">{_inr(balance_inr)}</td></tr>
        </table>
        <p style="margin:22px 0 0;font-size:13px;line-height:1.55;color:#5c5449;">
          Stash receipts for the campfire stories. Reply to this email or ping us if the trail map needs a tweak.
        </p>
        <p style="margin:20px 0 0;font-size:15px;line-height:1.5;color:#333;">
          Trails &amp; high-fives,<br /><strong style="color:{forest};">Team Wonder Baboon</strong></p>
      </td></tr>
      <tr><td style="padding:14px 20px;background:#eadfce;font-size:11px;color:#6b6054;text-align:center;">
        You’re officially on the wander-list. Carry light, tread kind.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def backpacking_confirmation_plain_text(
  *,
  full_name: str,
  destination: str,
  travel_date: str,
  people_line: str,
  package_total_inr: int,
  advance_inr: int,
  balance_inr: int,
  booking_display_id: str,
) -> str:
  g = full_name.strip() if full_name else "Explorer"
  return (
    f"Pack your sack — Wonder Baboon\n\nHi {g},\n\n"
    f"This email confirms your booking for {destination} on {travel_date}.\n"
    f"Tribe size: {people_line}\n"
    f"Reference: {booking_display_id}\n\n"
    "--- Your backpacking ledger ---\n"
    f"Package total (estimate): {_inr(package_total_inr)}\n"
    f"Advance received: {_inr(advance_inr)}\n"
    f"Balance due: {_inr(balance_inr)}\n\n"
    "Questions? Just reply — we're here between trails.\n"
    "Team Wonder Baboon\n"
  )


def backpacker_pending_booking_html(
  *,
  full_name: str,
  destination: str,
  travel_date: str,
  people_line: str,
  booking_display_id: str,
  package_total_inr: Optional[int],
) -> str:
  """Same palette/canvas as confirmation mail — pending advance."""
  greeting = full_name.strip() if full_name else "Explorer"
  accent = "#c4621a"
  forest = "#1e3d2f"
  sand = "#f4ede3"
  total_cell = (
    f'<td style="padding:14px 16px;background:{sand};text-align:right;font-weight:900;font-size:18px;color:{accent};">{_inr(package_total_inr)}</td>'
    if package_total_inr is not None
    else f'<td style="padding:14px 16px;background:{sand};text-align:right;font-weight:700;font-size:14px;color:#5c5449;line-height:1.4;">Quote coming soon<br/><span style="font-size:12px;font-weight:600;">Custom trips — totals sent after review</span></td>'
  )
  total_label = (
    "Estimated package total <span style=\"font-weight:600;color:#78350f;\">(pending payment)</span>"
    if package_total_inr is not None
    else "Package total <span style=\"font-weight:600;color:#78350f;\">(pending quote)</span>"
  )
  return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width" />
<title>Booking received</title></head>
<body style="margin:0;padding:0;background:#e8dfd0;font-family:'Segoe UI',Roboto,Georgia,ui-serif,sans-serif;color:#3d3428;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(160deg,#2d4a3a 0%,#c4621a 140%);padding:36px 12px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:{sand};border-radius:14px;overflow:hidden;box-shadow:0 18px 45px rgba(30,61,47,0.35);border:2px solid #d4cbb8;">
      <tr><td style="background:{forest};padding:26px 28px;color:#eef6f2;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.38em;text-transform:uppercase;opacity:0.92;">Trail note</p>
        <h1 style="margin:0;font-size:26px;line-height:1.15;font-weight:800;">You’re on the map — Wonder Baboon</h1>
        <p style="margin:12px 0 0;font-size:15px;opacity:0.95;">We’ve logged your booking. Full clearance waits on advance payment.</p>
      </td></tr>
      <tr><td style="padding:28px 26px;">
        <p style="margin:0 0 18px;font-size:17px;line-height:1.5;">Namaste, {_safe(greeting)},</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#4a4338;">
          Thanks for choosing us for <strong>{_safe(destination)}</strong>. Your reservation is <strong style="color:{accent};">pending</strong>
          until we receive advance payment — {_safe(travel_date)} stays reserved on our side while we coordinate with you.
        </p>
        <div style="margin:22px 0;padding:18px 16px;background:#faf6ef;border-radius:10px;border:1px dashed {accent};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="8" style="font-size:14px;color:#3d3428;">
            <tr><td style="opacity:0.75;">📍 Escape</td><td style="font-weight:700;text-align:right;">{_safe(destination)}</td></tr>
            <tr><td style="opacity:0.75;">📅 Roll-out</td><td style="font-weight:700;text-align:right;">{_safe(travel_date)}</td></tr>
            <tr><td style="opacity:0.75;">🥾 Tribe size</td><td style="font-weight:700;text-align:right;">{_safe(people_line)}</td></tr>
            <tr><td style="opacity:0.75;">📋 Reference</td><td style="font-family:monospace;text-align:right;">{_safe(booking_display_id)}</td></tr>
          </table>
        </div>
        <h2 style="margin:24px 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:0.2em;color:{forest};">Ledger on the ridge</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:10px;overflow:hidden;border:1px solid #dce3d9;">
          <tr style="background:{forest};color:#eef6f2;"><td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;">Payment status — awaiting advance</td></tr>
          <tr><td style="padding:14px 16px;background:#ffffff;font-weight:700;color:#78350f;">{total_label}</td>{total_cell}</tr>
        </table>
        <div style="margin:18px 0 0;padding:14px 16px;background:#fef3c7;border-radius:10px;border:1px solid #eab308;color:#78350f;font-size:13px;line-height:1.55;">
          <strong>Heads up:</strong> Your booking will be <strong>officially confirmed</strong> only after we receive your advance payment from our team’s instructions.
        </div>
        <div style="margin:12px 0 0;padding:14px 16px;background:#fceee9;border-radius:10px;border:1px solid #e89880;color:#7c2d12;font-size:13px;line-height:1.55;">
          <strong>Important:</strong> Advance payments are <strong>non-refundable</strong>. Please review dates and traveller names before paying.
        </div>
        <p style="margin:22px 0 0;font-size:13px;line-height:1.55;color:#5c5449;">
          Dust off your inbox — we’ll follow up shortly with next steps. Reply here anytime if the trail shifts.
        </p>
        <p style="margin:20px 0 0;font-size:15px;line-height:1.5;color:#333;">
          Trails &amp; patience,<br /><strong style="color:{forest};">Team Wonder Baboon</strong></p>
      </td></tr>
      <tr><td style="padding:14px 20px;background:#eadfce;font-size:11px;color:#6b6054;text-align:center;">
        Booking pending payment — carry light, tread kind.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def backpacker_pending_booking_plain_text(
  *,
  full_name: str,
  destination: str,
  travel_date: str,
  people_line: str,
  booking_display_id: str,
  package_total_inr: Optional[int],
) -> str:
  g = full_name.strip() if full_name else "Explorer"
  total_line = (
    f"Estimated package total (pending payment): {_inr(package_total_inr)}\n"
    if package_total_inr is not None
    else "Package total: we'll send your quote after reviewing your custom brief.\n"
  )
  return (
    f"You’re on the map — Wonder Baboon\n\nHi {g},\n\n"
    f"We received your booking for {destination} ({travel_date}). "
    "Status: PENDING until advance payment.\n\n"
    f"Tribe size: {people_line}\n"
    f"Reference: {booking_display_id}\n\n"
    "--- Ledger ---\n"
    f"{total_line}\n"
    "Your booking will be officially confirmed only after we receive your advance payment.\n\n"
    "IMPORTANT: Advance payments are non-refundable.\n\n"
    "Questions? Reply to this email.\n"
    "Team Wonder Baboon\n"
  )


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

  def send_plain_and_html(
    self, to: str, subject: str, plain: str, html_body: str
  ) -> Tuple[bool, Optional[str]]:
    """Multi-part email (readable plain + richer HTML fallback). Same return contract as send()."""
    if not self.is_configured:
      if IS_PRODUCTION:
        logger.error("SMTP not configured in production; cannot send HTML email to %s", to)
        return False, "email is not configured on the server"
      logger.warning(
        "[DEV] SMTP not configured. Email to %s — subject=%s\nPLAINTEXT:\n%s\n--- HTML (truncated if long) ---\n%s\n",
        to,
        subject,
        plain,
        html_body[:2000] + ("…\n[truncated]" if len(html_body) > 2000 else ""),
      )
      return True, None

    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(plain)
    msg.add_alternative(html_body, subtype="html")

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
      logger.info("Multipart email sent to %s (subject=%s)", to, subject)
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
      logger.exception("Failed to send multipart email to %s: %s", to, exc)
      return False, "could not send email; check server logs or try again later"

  def notify_booking_confirmed_traveler(
    self,
    to: str,
    booking: Dict[str, Any],
    *,
    package_total_inr: int,
    advance_payment_inr: int,
    balance_due_inr: int,
  ) -> None:
    """Celebrate with the guest; failures are logged only (booking already saved)."""
    dest = str(booking.get("travelDestination") or "Trip")
    subject = f"Packed & confirmed — {dest} | Wonder Baboon"
    dot = str(booking.get("dateOfTravel") or "")
    try:
      y, m, da = dot.split("-")
      travel_human = datetime(int(y), int(m), int(da)).strftime("%d %b %Y")
    except (TypeError, ValueError):
      travel_human = dot or "—"

    raw_id = booking.get("_id")
    booking_display = str(raw_id).strip() if raw_id else "—"
    raw_people = booking.get("numberOfPeople") or 1
    try:
      n_peep = max(1, int(raw_people))
    except (TypeError, ValueError):
      n_peep = 1
    people_line = f"{n_peep} hikers" if n_peep != 1 else "1 hiker"

    lead_name = str(booking.get("fullName") or "").strip()
    if not lead_name:
      trav = booking.get("travelers")
      if isinstance(trav, list) and trav:
        lead_name = str(trav[0] or "").strip()

    kw = dict(
      full_name=lead_name or "Explorer",
      destination=str(dest),
      travel_date=str(travel_human),
      people_line=people_line,
      package_total_inr=int(package_total_inr),
      advance_inr=int(advance_payment_inr),
      balance_inr=int(balance_due_inr),
      booking_display_id=booking_display,
    )
    html_body = backpacker_confirmation_html(**kw)
    plain = backpacking_confirmation_plain_text(**kw)
    ok, err = self.send_plain_and_html(to, subject, plain, html_body)
    if not ok:
      logger.error("Traveler confirmation email failed: %s", err)

  def notify_booking_pending_traveler(
    self,
    to: str,
    booking: Dict[str, Any],
    *,
    package_total_inr: Optional[int],
  ) -> None:
    """Acknowledge submission — pending advance; failures logged only."""
    dest = str(booking.get("travelDestination") or "Trip")
    subject = f"Booking received — pending payment | {dest}"
    dot = str(booking.get("dateOfTravel") or "")
    try:
      y, m, da = dot.split("-")
      travel_human = datetime(int(y), int(m), int(da)).strftime("%d %b %Y")
    except (TypeError, ValueError):
      travel_human = dot or "—"

    raw_id = booking.get("_id")
    booking_display = str(raw_id).strip() if raw_id else "—"
    raw_people = booking.get("numberOfPeople") or 1
    try:
      n_peep = max(1, int(raw_people))
    except (TypeError, ValueError):
      n_peep = 1
    people_line = f"{n_peep} hikers" if n_peep != 1 else "1 hiker"

    lead_name = str(booking.get("fullName") or "").strip()
    if not lead_name:
      trav = booking.get("travelers")
      if isinstance(trav, list) and trav:
        lead_name = str(trav[0] or "").strip()

    kw = dict(
      full_name=lead_name or "Explorer",
      destination=str(dest),
      travel_date=str(travel_human),
      people_line=people_line,
      booking_display_id=booking_display,
      package_total_inr=package_total_inr,
    )
    html_body = backpacker_pending_booking_html(**kw)
    plain = backpacker_pending_booking_plain_text(**kw)
    ok, err = self.send_plain_and_html(to, subject, plain, html_body)
    if not ok:
      logger.error("Traveler pending-booking email failed: %s", err)

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
    ]
    travelers = doc.get("travelers")
    if isinstance(travelers, list) and travelers:
      lines.append("Travelers:")
      for i, nm in enumerate(travelers, start=1):
        lines.append(f"  {i}. {nm}")
    else:
      for i in range(1, 21):
        key = f"traveler{i}"
        if key in doc and doc.get(key):
          lines.append(f"  {key}: {doc.get(key)}")
    lines.extend(
      [
        f"Payment:        {doc.get('payment')}",
        f"Source:         {doc.get('source')}",
      ]
    )
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
