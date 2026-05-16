import logging
import smtplib
from email.message import EmailMessage
from typing import Optional, Tuple

from config import IS_PRODUCTION, SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USE_TLS, SMTP_USER

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


email_service = EmailService()
