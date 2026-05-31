import html
import logging
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Any, Dict, List, Optional, Tuple

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


def _member_update_traveler_copy(
  triggered_by: str,
  destination: str,
  travel_date: str,
  *,
  reopened_balance: bool = False,
) -> Dict[str, str]:
  dest = _safe(destination)
  date = _safe(travel_date)
  if triggered_by == "admin" and reopened_balance:
    return {
      "subject_action": "Remaining payment due",
      "page_title": "Remaining payment due",
      "headline": "New travelers — payment due",
      "header_note": (
        f"Your booking for {dest} was fully paid. "
        "These new travelers need an additional payment."
      ),
      "intro": (
        f"We added the following traveler(s) to your booking for <strong>{dest}</strong> on {date}:"
      ),
      "plain_title": "Remaining payment due — Wonder Baboon",
      "plain_intro": (
        f"We added traveler(s) to your fully paid booking for {destination} on {travel_date}. "
        "Please pay the remaining balance below:"
      ),
    }
  if triggered_by == "admin":
    return {
      "subject_action": "Travelers added",
      "page_title": "Travelers added",
      "headline": "New travelers added",
      "header_note": f"Your booking for {dest} has been updated.",
      "intro": (
        f"We added the following traveler(s) to your booking for <strong>{dest}</strong> on {date}:"
      ),
      "plain_title": "Travelers added — Wonder Baboon",
      "plain_intro": f"We added traveler(s) to your booking for {destination} on {travel_date}:",
    }
  return {
    "subject_action": "Booking updated",
    "page_title": "Booking updated",
    "headline": "Travelers updated",
    "header_note": f"Your group for {dest} on {date} has been updated.",
    "intro": (
      f"You updated your booking with the following traveler(s) for <strong>{dest}</strong> on {date}:"
    ),
    "plain_title": "Booking updated — Wonder Baboon",
    "plain_intro": f"You updated your booking for {destination} on {travel_date} with:",
  }


def member_update_traveler_html(
  *,
  full_name: str,
  destination: str,
  travel_date: str,
  added_names: List[str],
  old_balance_due_inr: int,
  added_amount_inr: int,
  new_balance_due_inr: int,
  booking_display_id: str,
  triggered_by: str = "admin",
  reopened_balance: bool = False,
) -> str:
  greeting = full_name.strip() if full_name else "Explorer"
  accent = "#c4621a"
  forest = "#1e3d2f"
  sand = "#f4ede3"
  copy = _member_update_traveler_copy(
    triggered_by, destination, travel_date, reopened_balance=reopened_balance
  )
  added_list = "".join(
    f'<li style="margin:6px 0;font-size:15px;font-weight:700;color:#3d3428;">{_safe(nm)}</li>'
    for nm in added_names
    if nm.strip()
  )
  return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width" />
<title>{copy["page_title"]}</title></head>
<body style="margin:0;padding:0;background:#e8dfd0;font-family:'Segoe UI',Roboto,Georgia,ui-serif,sans-serif;color:#3d3428;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(160deg,#2d4a3a 0%,#c4621a 140%);padding:36px 12px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:{sand};border-radius:14px;overflow:hidden;box-shadow:0 18px 45px rgba(30,61,47,0.35);border:2px solid #d4cbb8;">
      <tr><td style="background:{forest};padding:26px 28px;color:#eef6f2;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.38em;text-transform:uppercase;opacity:0.92;">Group update</p>
        <h1 style="margin:0;font-size:24px;line-height:1.2;font-weight:800;">{copy["headline"]}</h1>
        <p style="margin:12px 0 0;font-size:15px;opacity:0.95;">{copy["header_note"]}</p>
      </td></tr>
      <tr><td style="padding:28px 26px;">
        <p style="margin:0 0 18px;font-size:17px;line-height:1.5;">Hi {_safe(greeting)},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a4338;">
          {copy["intro"]}
        </p>
        <ul style="margin:0 0 22px;padding-left:22px;">{added_list}</ul>
        <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:0.2em;color:{forest};">Updated balance</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:10px;overflow:hidden;border:1px solid #dce3d9;">
          <tr style="background:{forest};color:#eef6f2;"><td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;">What you owe now</td></tr>
          <tr><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#ffffff;">Balance due before this update</td><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#ffffff;text-align:right;font-weight:700;">{_inr(old_balance_due_inr)}</td></tr>
          <tr><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#fafafa;">Added for new traveler(s)</td><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#fafafa;text-align:right;font-weight:800;color:{accent};">+ {_inr(added_amount_inr)}</td></tr>
          <tr><td style="padding:14px 16px;background:{sand};font-weight:800;">New balance due</td><td style="padding:14px 16px;background:{sand};text-align:right;font-weight:900;font-size:18px;color:{accent};">{_inr(new_balance_due_inr)}</td></tr>
        </table>
        <p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:#5c5449;">
          Reference: <span style="font-family:monospace;">{_safe(booking_display_id)}</span><br />
          Advance already paid stays the same — only the remaining balance changed.
        </p>
        <p style="margin:20px 0 0;font-size:15px;line-height:1.5;color:#333;">
          Trails &amp; high-fives,<br /><strong style="color:{forest};">Team Wonder Baboon</strong></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def member_update_traveler_plain_text(
  *,
  full_name: str,
  destination: str,
  travel_date: str,
  added_names: List[str],
  old_balance_due_inr: int,
  added_amount_inr: int,
  new_balance_due_inr: int,
  booking_display_id: str,
  triggered_by: str = "admin",
  reopened_balance: bool = False,
) -> str:
  g = full_name.strip() if full_name else "Explorer"
  copy = _member_update_traveler_copy(
    triggered_by, destination, travel_date, reopened_balance=reopened_balance
  )
  added_lines = "\n".join(f"  • {nm}" for nm in added_names if nm.strip()) or "  —"
  return "\n".join(
    [
      copy["plain_title"],
      "",
      f"Hi {g},",
      "",
      copy["plain_intro"],
      added_lines,
      "",
      "--- Updated balance ---",
      f"Balance due before:      {_inr(old_balance_due_inr)}",
      f"Added for new member(s): +{_inr(added_amount_inr)}",
      f"New balance due:         {_inr(new_balance_due_inr)}",
      "",
      f"Reference: {booking_display_id}",
      "Advance already paid is unchanged.",
      "",
      "Team Wonder Baboon",
    ]
  )


def _traveler_roster_lines(booking: Dict[str, Any]) -> List[str]:
  names: List[str] = []
  if isinstance(booking.get("travelers"), list) and booking["travelers"]:
    names = [str(x).strip() for x in booking["travelers"] if str(x).strip()]
  else:
    if booking.get("fullName"):
      names.append(str(booking["fullName"]).strip())
    for i in range(2, 21):
      key = f"traveler{i}"
      if booking.get(key):
        names.append(str(booking[key]).strip())
  return [f"  {i + 1}. {nm}" for i, nm in enumerate(names) if nm]


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
    subject = f"Advance received — {dest} | Wonder Baboon"
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

  def notify_full_payment_received_traveler(
    self,
    to: str,
    booking: Dict[str, Any],
    *,
    package_total_inr: int,
  ) -> None:
    """All dues cleared; remaining balance is zero."""
    dest = str(booking.get("travelDestination") or "Trip")
    subject = f"Full payment received — {dest} | Wonder Baboon"
    dot = str(booking.get("dateOfTravel") or "")
    try:
      y, m, da = dot.split("-")
      travel_human = datetime(int(y), int(m), int(da)).strftime("%d %b %Y")
    except (TypeError, ValueError):
      travel_human = dot or "—"

    raw_id = booking.get("_id")
    booking_display = str(raw_id).strip() if raw_id else "—"
    lead_name = str(booking.get("fullName") or "").strip()
    if not lead_name:
      trav = booking.get("travelers")
      if isinstance(trav, list) and trav:
        lead_name = str(trav[0] or "").strip()

    greeting = lead_name or "Explorer"
    accent = "#c4621a"
    forest = "#1e3d2f"
    sand = "#f4ede3"
    html_body = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width" />
<title>Full payment received</title></head>
<body style="margin:0;padding:0;background:#e8dfd0;font-family:'Segoe UI',Roboto,Georgia,ui-serif,sans-serif;color:#3d3428;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(160deg,#2d4a3a 0%,#c4621a 140%);padding:36px 12px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:{sand};border-radius:14px;overflow:hidden;box-shadow:0 18px 45px rgba(30,61,47,0.35);border:2px solid #d4cbb8;">
      <tr><td style="background:{forest};padding:26px 28px;color:#eef6f2;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.38em;text-transform:uppercase;opacity:0.92;">All clear</p>
        <h1 style="margin:0;font-size:24px;line-height:1.2;font-weight:800;">Full payment received</h1>
        <p style="margin:12px 0 0;font-size:15px;opacity:0.95;">Your booking for {_safe(dest)} is fully paid.</p>
      </td></tr>
      <tr><td style="padding:28px 26px;">
        <p style="margin:0 0 18px;font-size:17px;line-height:1.5;">Hi {_safe(greeting)},</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#4a4338;">
          We’ve received your <strong>full payment</strong> for <strong>{_safe(dest)}</strong> on {_safe(travel_human)}.
          Nothing left to pay — you’re all set for wheels up.
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:10px;overflow:hidden;border:1px solid #dce3d9;">
          <tr style="background:{forest};color:#eef6f2;"><td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;">Payment summary</td></tr>
          <tr><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#ffffff;">Package total</td><td style="padding:14px 16px;border-bottom:1px solid #eae4d8;background:#ffffff;text-align:right;font-weight:800;">{_inr(package_total_inr)}</td></tr>
          <tr><td style="padding:14px 16px;background:{sand};font-weight:800;">Remaining balance</td><td style="padding:14px 16px;background:{sand};text-align:right;font-weight:900;font-size:18px;color:#166534;">{_inr(0)}</td></tr>
        </table>
        <p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:#5c5449;">
          Reference: <span style="font-family:monospace;">{_safe(booking_display)}</span>
        </p>
        <p style="margin:20px 0 0;font-size:15px;line-height:1.5;color:#333;">
          Trails &amp; high-fives,<br /><strong style="color:{forest};">Team Wonder Baboon</strong></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""
    plain = "\n".join(
      [
        "Full payment received — Wonder Baboon",
        "",
        f"Hi {greeting},",
        "",
        f"We've received your full payment for {dest} on {travel_human}.",
        "",
        "--- Payment summary ---",
        f"Package total:       {_inr(package_total_inr)}",
        f"Remaining balance:   {_inr(0)}",
        "",
        f"Reference: {booking_display}",
        "",
        "You're all set — nothing left to pay.",
        "",
        "Team Wonder Baboon",
      ]
    )
    ok, err = self.send_plain_and_html(to, subject, plain, html_body)
    if not ok:
      logger.error("Traveler full-payment email failed: %s", err)

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

  def notify_new_booking(self, doc: Dict[str, Any], *, payment_pending: bool = False) -> None:
    """Alert ops inbox when a booking is saved. Failures are logged only (booking already persisted)."""
    if not BOOKING_NOTIFY_EMAIL:
      return
    dest = str(doc.get("travelDestination") or "Trip")
    travel_date = str(doc.get("dateOfTravel") or "")
    if payment_pending:
      subject = f"[Wonder Baboon] Booking started — advance payment pending — {dest} ({travel_date})"
      headline = "Someone started a booking and opened advance payment (not confirmed until paid)."
    else:
      subject = f"[Wonder Baboon] New booking — {dest} ({travel_date})"
      headline = "A new booking was submitted on Wonder Baboon."
    lines = [
      headline,
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

  def notify_booking_members_updated(
    self,
    booking: Dict[str, Any],
    *,
    old_people: int,
    new_people: int,
    package_total_inr: int,
    advance_payment_inr: int,
    balance_due_inr: int,
    added_names: List[str],
    triggered_by: str,
    old_package_total_inr: int = 0,
    old_advance_payment_inr: int = 0,
    old_balance_due_inr: int = 0,
    old_payment_status: str = "",
  ) -> None:
    """Alert admin + traveler when tribe size changes."""
    dest = str(booking.get("travelDestination") or "Trip")
    booking_id = str(booking.get("_id") or "—")
    added_block = (
      "\n".join(f"  {i + 1}. {nm}" for i, nm in enumerate(added_names) if nm.strip())
      if added_names
      else "  —"
    )
    roster_block = "\n".join(_traveler_roster_lines(booking)) or "  —"
    who_by = "Wonder Baboon admin" if triggered_by == "admin" else "you (from your account)"

    added_amount_inr = max(0, int(package_total_inr) - int(old_package_total_inr or 0))
    prev_balance = int(old_balance_due_inr or 0)
    reopened_balance = (
      triggered_by == "admin"
      and str(old_payment_status or "") == "paid"
      and prev_balance <= 0
      and int(balance_due_inr) > 0
    )

    if BOOKING_NOTIFY_EMAIL:
      admin_subject = f"[Wonder Baboon] Travelers added ({old_people}→{new_people}) — {dest}"
      admin_body = "\n".join(
        [
          "New travelers were added to a booking.",
          "",
          f"Updated by:     {who_by}",
          f"Booking ID:     {booking_id}",
          f"Destination:    {dest}",
          f"Travel date:    {booking.get('dateOfTravel')}",
          f"Lead contact:   {booking.get('fullName')} · {booking.get('mobile')} · {booking.get('email')}",
          "",
          f"Group size:     {old_people} → {new_people} travelers",
          "",
          "Names added now:",
          added_block,
          "",
          "Full group list (after update):",
          roster_block,
          "",
          "--- Payment ---",
          f"Balance due before:      {_inr(prev_balance)}",
          f"Added for new member(s): +{_inr(added_amount_inr)}",
          f"New balance due:         {_inr(balance_due_inr)}",
          f"Package total:           {_inr(old_package_total_inr)} → {_inr(package_total_inr)}",
          f"Advance paid:            {_inr(advance_payment_inr)} (unchanged)",
        ]
      )
      ok, err = self.send(BOOKING_NOTIFY_EMAIL, admin_subject, admin_body)
      if not ok:
        logger.error("Admin member-update email failed: %s", err)

    inbox = str(booking.get("email") or "").strip()
    if not inbox or "@" not in inbox:
      return

    dot = str(booking.get("dateOfTravel") or "")
    try:
      y, m, da = dot.split("-")
      travel_human = datetime(int(y), int(m), int(da)).strftime("%d %b %Y")
    except (TypeError, ValueError):
      travel_human = dot or "—"

    lead_name = str(booking.get("fullName") or "").strip()
    if not lead_name:
      trav = booking.get("travelers")
      if isinstance(trav, list) and trav:
        lead_name = str(trav[0] or "").strip()

    copy = _member_update_traveler_copy(
      triggered_by, dest, travel_human, reopened_balance=reopened_balance
    )
    subject = f"{copy['subject_action']} — {dest} | Wonder Baboon"
    kw = dict(
      full_name=lead_name or "Explorer",
      destination=dest,
      travel_date=travel_human,
      added_names=added_names,
      old_balance_due_inr=prev_balance,
      added_amount_inr=added_amount_inr,
      new_balance_due_inr=int(balance_due_inr),
      booking_display_id=booking_id,
      triggered_by=triggered_by,
      reopened_balance=reopened_balance,
    )
    html_body = member_update_traveler_html(**kw)
    plain = member_update_traveler_plain_text(**kw)
    ok, err = self.send_plain_and_html(inbox, subject, plain, html_body)
    if not ok:
      logger.error("Traveler member-update email failed: %s", err)


email_service = EmailService()
