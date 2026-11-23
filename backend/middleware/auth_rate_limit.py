import os
import time
from collections import defaultdict
from threading import Lock
from typing import Awaitable, Callable

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from config import TRUSTED_PROXY_HOPS

MAX_REQ = int(os.getenv("AUTH_RATE_LIMIT_MAX", "25"))
WINDOW_SEC = float(os.getenv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "120"))

# path -> (max requests, window seconds). Everything else is not limited.
_LIMITS: dict[str, tuple[int, float]] = {
  "/api/auth/login": (MAX_REQ, WINDOW_SEC),
  "/api/auth/signup": (MAX_REQ, WINDOW_SEC),
  "/api/bookings/guest": (12, 600),
  "/api/planned-trips": (12, 600),
  "/api/payments/razorpay/create-order": (30, 600),
  "/api/payments/razorpay/verify": (30, 600),
  "/api/user/profile/email-otp/request": (8, 600),
  "/api/user/profile/mobile-otp/request": (8, 600),
  "/api/user/profile/email-otp/verify": (15, 600),
  "/api/user/profile/mobile-otp/verify": (15, 600),
}
_MAX_BUCKETS = 20000

_buckets: dict[str, list[float]] = defaultdict(list)
_lock = Lock()


def client_ip(request: Request) -> str:
  """Real client IP. X-Forwarded-For is appended to by each proxy, so only the entry added by
  *our* proxy (counted from the right) can be trusted — the left side is attacker-controlled."""
  if TRUSTED_PROXY_HOPS > 0:
    parts = [p.strip() for p in (request.headers.get("x-forwarded-for") or "").split(",") if p.strip()]
    if len(parts) >= TRUSTED_PROXY_HOPS:
      return parts[-TRUSTED_PROXY_HOPS]
  if request.client:
    return request.client.host or "unknown"
  return "unknown"


async def auth_rate_limit_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
  limit = _LIMITS.get(request.url.path) if request.method == "POST" else None
  if limit:
    max_req, window = limit
    key = f"{client_ip(request)}:{request.url.path}"
    now = time.monotonic()
    with _lock:
      if len(_buckets) > _MAX_BUCKETS:  # memory guard against key flooding
        for k in [k for k, v in _buckets.items() if not v or v[-1] < now - 3600][:5000]:
          _buckets.pop(k, None)
      bucket = _buckets[key]
      cutoff = now - window
      while bucket and bucket[0] < cutoff:
        bucket.pop(0)
      if len(bucket) >= max_req:
        return JSONResponse(
          status_code=429,
          content={"detail": "too many requests; try again later"},
          headers={"Retry-After": str(int(window))},
        )
      bucket.append(now)
  return await call_next(request)
