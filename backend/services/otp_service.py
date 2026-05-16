import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from config import OTP_RATE_LIMIT_SECONDS, OTP_TTL_SECONDS
from services.email_service import email_service
from services.mongo_service import mongo_service

logger = logging.getLogger(__name__)


def _hash_code(code: str, salt: str) -> str:
  return hashlib.sha256(f"{salt}:{code}".encode("utf-8")).hexdigest()


class OtpService:
  def request(self, user_email: str, kind: str, new_value: str) -> Tuple[bool, str]:
    """Generate an OTP, persist it, and email it.

    kind: "email" | "mobile"
    For kind=email -> OTP is sent to new_value (the new email)
    For kind=mobile -> OTP is sent to user_email (the existing account email)
    Returns (ok, message). Never returns the OTP.
    """
    if kind not in {"email", "mobile"}:
      return False, "invalid kind"

    now = datetime.now(timezone.utc)
    recent = mongo_service.find_latest_otp(user_email, kind)
    if recent and (now - recent["createdAt"].replace(tzinfo=timezone.utc)).total_seconds() < OTP_RATE_LIMIT_SECONDS:
      remaining = OTP_RATE_LIMIT_SECONDS - int(
        (now - recent["createdAt"].replace(tzinfo=timezone.utc)).total_seconds()
      )
      logger.info("OTP rate-limited for %s/%s (retry in %ss)", user_email, kind, remaining)
      return False, f"please wait {remaining}s before requesting another code"

    code = f"{secrets.randbelow(1_000_000):06d}"
    salt = secrets.token_hex(8)
    expires_at = now + timedelta(seconds=OTP_TTL_SECONDS)

    target = new_value if kind == "email" else user_email
    subject = "Your Wonder Baboon verification code"
    body = (
      f"Hi,\n\nYour verification code is: {code}\n\n"
      f"This code expires in {OTP_TTL_SECONDS // 60} minutes.\n"
      f"If you didn't request this, you can safely ignore it.\n\n— Wonder Baboon"
    )
    ok, send_err = email_service.send(target, subject, body)
    if not ok:
      logger.error("OTP for %s/%s not saved — email send failed", user_email, kind)
      return False, send_err or "could not send verification email; try again later"

    mongo_service.save_otp(
      {
        "userEmail": user_email,
        "kind": kind,
        "newValue": new_value,
        "codeHash": _hash_code(code, salt),
        "salt": salt,
        "attempts": 0,
        "createdAt": now,
        "expiresAt": expires_at,
        "consumed": False,
      }
    )

    logger.info("OTP issued for %s/%s -> %s", user_email, kind, target)
    return True, "verification code sent"

  def verify(self, user_email: str, kind: str, code: str) -> Optional[str]:
    """Returns new_value to apply if valid, else None."""
    now = datetime.now(timezone.utc)
    otp = mongo_service.find_latest_otp(user_email, kind)
    if not otp:
      logger.info("No OTP record for %s/%s", user_email, kind)
      return None
    if otp.get("consumed"):
      logger.info("OTP already consumed for %s/%s", user_email, kind)
      return None
    expires = otp["expiresAt"]
    if expires.tzinfo is None:
      expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
      logger.info("OTP expired for %s/%s", user_email, kind)
      return None
    if otp.get("attempts", 0) >= 5:
      logger.warning("OTP attempt limit reached for %s/%s", user_email, kind)
      return None

    expected = _hash_code(str(code).strip(), otp["salt"])
    if not hmac.compare_digest(expected, otp["codeHash"]):
      mongo_service.increment_otp_attempts(otp["_id"])
      logger.info("OTP mismatch for %s/%s", user_email, kind)
      return None

    mongo_service.consume_otp(otp["_id"])
    logger.info("OTP verified for %s/%s", user_email, kind)
    return otp.get("newValue")


otp_service = OtpService()
