import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException
from jose import JWTError, jwt

from config import JWT_ALGORITHM, JWT_EXPIRE_HOURS, JWT_SECRET, PENDING_BOOKING_EXPIRE_HOURS

PENDING_BOOKING_TOKEN_TYPE = "pending_booking"


def normalize_indian_mobile(value: str) -> str:
  """Accept +91 / leading 0; store as 10-digit Indian mobile (6–9 start)."""
  raw = str(value or "").strip()
  if not raw:
    raise ValueError("please enter a valid mobile number")
  digits = re.sub(r"\D", "", raw)
  if digits.startswith("91") and len(digits) >= 12:
    digits = digits[2:]
  if len(digits) == 11 and digits.startswith("0"):
    digits = digits[1:]
  if not re.fullmatch(r"^[6-9]\d{9}$", digits):
    raise ValueError("please enter a valid mobile number")
  return digits


def sanitize_text(value: str, field: str = "value") -> str:
  cleaned = value.strip()
  if not cleaned:
    raise ValueError(f"{field} is required")
  if re.search(r"(script|select|drop|delete|<|>)", cleaned, re.IGNORECASE):
    raise ValueError(f"{field} contains invalid content")
  return cleaned


def hash_password(password: str) -> str:
  salt = secrets.token_hex(16)
  digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200000).hex()
  return f"{salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
  try:
    salt, digest = stored_hash.split("$", 1)
  except ValueError:
    return False
  candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200000).hex()
  return hmac.compare_digest(candidate, digest)


def create_token(payload: dict) -> str:
  exp = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
  return jwt.encode({**payload, "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(authorization: Optional[str]) -> Optional[dict]:
  if not authorization or not authorization.startswith("Bearer "):
    return None
  token = authorization.split(" ", 1)[1].strip()
  if not token:
    return None
  try:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
  except JWTError:
    return None


def require_admin(authorization: Optional[str] = Header(default=None)) -> dict:
  payload = decode_token(authorization)
  if not payload or payload.get("role") != "admin":
    raise HTTPException(status_code=403, detail="Admin access required")
  return payload


def _serialize_booking_doc_for_token(doc: Dict[str, Any]) -> Dict[str, Any]:
  out = {k: v for k, v in doc.items() if k != "_id"}
  created = out.get("createdAt")
  if isinstance(created, datetime):
    out["createdAt"] = created.replace(tzinfo=timezone.utc).isoformat()
  return out


def create_pending_booking_token(doc: Dict[str, Any]) -> str:
  """Signed payload held client-side until Razorpay advance succeeds (no DB row yet)."""
  exp = datetime.now(timezone.utc) + timedelta(hours=PENDING_BOOKING_EXPIRE_HOURS)
  payload = {
    "typ": PENDING_BOOKING_TOKEN_TYPE,
    "doc": _serialize_booking_doc_for_token(doc),
    "exp": exp,
  }
  return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_pending_booking_token(token: str) -> Dict[str, Any]:
  cleaned = (token or "").strip()
  if not cleaned:
    raise HTTPException(status_code=400, detail="booking session is missing — please start again")
  try:
    payload = jwt.decode(cleaned, JWT_SECRET, algorithms=[JWT_ALGORITHM])
  except JWTError:
    raise HTTPException(
      status_code=400,
      detail="booking session expired — please fill the form and try again",
    ) from None
  if payload.get("typ") != PENDING_BOOKING_TOKEN_TYPE:
    raise HTTPException(status_code=400, detail="invalid booking session")
  raw_doc = payload.get("doc")
  if not isinstance(raw_doc, dict):
    raise HTTPException(status_code=400, detail="invalid booking session")
  doc = dict(raw_doc)
  created = doc.get("createdAt")
  if isinstance(created, str):
    try:
      doc["createdAt"] = datetime.fromisoformat(created.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
      doc["createdAt"] = datetime.utcnow()
  return doc
