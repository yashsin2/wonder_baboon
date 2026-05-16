import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from config import LOG_LEVEL

_LOG_DIR = Path(__file__).resolve().parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)


class RequestIdFilter(logging.Filter):
  def filter(self, record: logging.LogRecord) -> bool:
    if not hasattr(record, "request_id"):
      record.request_id = "-"
    return True


def configure_logging() -> None:
  level = getattr(logging, LOG_LEVEL, logging.INFO)

  root = logging.getLogger()
  root.setLevel(level)
  for handler in list(root.handlers):
    root.removeHandler(handler)

  formatter = logging.Formatter(
    fmt="%(asctime)s | %(levelname)-7s | %(name)s | rid=%(request_id)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
  )
  req_filter = RequestIdFilter()

  stream = logging.StreamHandler(sys.stdout)
  stream.setLevel(level)
  stream.setFormatter(formatter)
  stream.addFilter(req_filter)
  root.addHandler(stream)

  file_handler = RotatingFileHandler(_LOG_DIR / "app.log", maxBytes=2_000_000, backupCount=5)
  file_handler.setLevel(level)
  file_handler.setFormatter(formatter)
  file_handler.addFilter(req_filter)
  root.addHandler(file_handler)

  for noisy in ("uvicorn.access",):
    logging.getLogger(noisy).setLevel(logging.WARNING)
