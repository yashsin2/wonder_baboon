import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Header, HTTPException
from jose import JWTError, jwt

from config import JWT_ALGORITHM, JWT_EXPIRE_HOURS, JWT_SECRET


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
