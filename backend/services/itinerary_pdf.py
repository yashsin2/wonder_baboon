"""Extract plain text from PDFs and convert to a minimal safe HTML fragment for trip itineraries."""

from __future__ import annotations

import html
import re
from io import BytesIO

from pypdf import PdfReader

# Skip noisy PDF page markers and lone bullets
_PAGE_MARKER = re.compile(r"^--\s*\d+\s+of\s+\d+\s+--$", re.I)
_BULLET_START = re.compile(r"^[\-\*•·●]\s*")


def pdf_bytes_to_itinerary_html(data: bytes, max_pages: int = 40) -> str:
  """Return HTML body suitable for embedding inside a modal (no scripts)."""
  if not data or len(data) > 5 * 1024 * 1024:
    raise ValueError("invalid or oversized PDF")

  try:
    reader = PdfReader(BytesIO(data))
  except Exception as exc:
    raise ValueError("could not read PDF file") from exc

  chunks: list[str] = []
  for i, page in enumerate(reader.pages):
    if i >= max_pages:
      chunks.append("\n… (additional pages omitted)")
      break
    text = page.extract_text()
    if text:
      chunks.append(text)

  raw = "\n".join(chunks)
  lines: list[str] = []
  for line in raw.splitlines():
    s = line.strip()
    if not s or _PAGE_MARKER.match(s):
      continue
    # collapse unicode bullets at line start to a standard marker
    if s.startswith("\uf0b7"):
      s = "• " + s[1:].lstrip()
    lines.append(s)

  if not lines:
    raise ValueError("no text could be extracted from this PDF")

  return _lines_to_safe_html(lines)


_NUM_BULLET = re.compile(r"^\d+[\.\)]\s+")


def _lines_to_safe_html(lines: list[str]) -> str:
  out: list[str] = ['<section class="itinerary-block itinerary-block--pdf">']
  in_list = False

  def close_list() -> None:
    nonlocal in_list
    if in_list:
      out.append("</ul>")
      in_list = False

  def is_bullet_line(line: str) -> bool:
    return bool(_BULLET_START.match(line)) or bool(_NUM_BULLET.match(line))

  def strip_bullet(line: str) -> str:
    m = _NUM_BULLET.match(line)
    if m:
      return line[m.end() :].strip()
    m2 = _BULLET_START.match(line)
    if m2:
      return line[m2.end() :].strip()
    return line

  for line in lines:
    if is_bullet_line(line):
      content = strip_bullet(line)
      esc = html.escape(content) if content else html.escape(line.strip())
      if not in_list:
        out.append("<ul>")
        in_list = True
      out.append(f"<li>{esc}</li>")
    else:
      close_list()
      esc = html.escape(line.strip())
      if esc:
        out.append(f"<p>{esc}</p>")

  close_list()
  out.append("</section>")
  return "\n".join(out)
