"""Razorpay Standard Checkout — orders and HMAC signature verification."""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, Optional, Tuple

from config import RAZORPAY_ADVANCE_PERCENT, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET

logger = logging.getLogger(__name__)

MIN_AMOUNT_PAISE = 100

_client = None


class RazorpayOrderError(Exception):
  """Razorpay order.create failed."""


class RazorpayAuthError(RazorpayOrderError):
  """Invalid KEY_ID / KEY_SECRET."""


def razorpay_enabled() -> bool:
  return bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)


def advance_percent() -> int:
  return max(1, min(99, int(RAZORPAY_ADVANCE_PERCENT)))


def compute_advance_inr(package_total_inr: int, percent: Optional[int] = None) -> Tuple[int, int]:
  """Return (advance_inr, balance_inr) for a package total."""
  total = max(1, int(package_total_inr))
  pct = advance_percent() if percent is None else max(1, min(99, int(percent)))
  advance = int(math.ceil(total * pct / 100))
  advance = max(1, min(advance, total))
  return advance, total - advance


def _get_client():
  global _client
  if _client is None:
    import razorpay

    _client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
  return _client


def reset_client() -> None:
  """Force new SDK client after .env key changes (restart API is still required)."""
  global _client
  _client = None


def create_order(
  amount_paise: int,
  receipt: str,
  notes: Optional[Dict[str, str]] = None,
  currency: str = "INR",
) -> Dict[str, Any]:
  """
  Razorpay Standard Checkout — POST /v1/orders.
  Amount must be in paise (minimum 100).
  """
  amount = int(amount_paise)
  if amount < MIN_AMOUNT_PAISE:
    raise ValueError(f"amount must be at least {MIN_AMOUNT_PAISE} paise")

  payload: Dict[str, Any] = {
    "amount": amount,
    "currency": (currency or "INR").upper(),
    "receipt": (receipt or "wb")[:40],
  }
  if notes:
    payload["notes"] = notes

  try:
    return _get_client().order.create(data=payload)
  except Exception as error:
    logger.error("Razorpay order.create failed: %s", error)
    msg = str(error).lower()
    if "authentication" in msg:
      raise RazorpayAuthError(str(error)) from error
    raise RazorpayOrderError(str(error)) from error


def order_exists_on_account(order_id: str) -> bool:
  """True if this order_id exists for the current KEY_ID / KEY_SECRET (live vs test must match)."""
  oid = (order_id or "").strip()
  if not oid:
    return False
  try:
    _get_client().order.fetch(oid)
    return True
  except Exception as error:
    logger.info("Razorpay order.fetch %s failed: %s", oid, error)
    return False


def verify_payment_signature(order_id: str, payment_id: str, signature: str) -> bool:
  """
  Standard Checkout verification: HMAC-SHA256(order_id|payment_id, KEY_SECRET).
  Must use client.utility — the SDK reads the secret from Client(auth=...), not a 2nd arg.
  """
  if not (order_id and payment_id and signature):
    return False

  params = {
    "razorpay_order_id": order_id.strip(),
    "razorpay_payment_id": payment_id.strip(),
    "razorpay_signature": signature.strip(),
  }
  try:
    _get_client().utility.verify_payment_signature(params)
    return True
  except Exception as error:
    logger.warning("Razorpay verify_payment_signature failed: %s", error)
    return False
