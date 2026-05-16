import os
import time
from collections import defaultdict
from threading import Lock
from typing import Awaitable, Callable

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

MAX_REQ = int(os.getenv("AUTH_RATE_LIMIT_MAX", "25"))
WINDOW_SEC = float(os.getenv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "120"))

_buckets: dict[str, list[float]] = defaultdict(list)
_lock = Lock()


def _client_ip(request: Request) -> str:
  forwarded = (request.headers.get("x-forwarded-for") or "").strip()
  if forwarded:
    return forwarded.split(",")[0].strip() or "unknown"
  if request.client:
    return request.client.host or "unknown"
  return "unknown"


async def auth_rate_limit_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
  if request.method == "POST" and request.url.path in ("/api/auth/login", "/api/auth/signup"):
    ip = _client_ip(request)
    key = f"{ip}:{request.url.path}"
    now = time.monotonic()
    with _lock:
      bucket = _buckets[key]
      cutoff = now - WINDOW_SEC
      while bucket and bucket[0] < cutoff:
        bucket.pop(0)
      if len(bucket) >= MAX_REQ:
        return JSONResponse(status_code=429, content={"detail": "too many requests; try again later"})
      bucket.append(now)
  return await call_next(request)
