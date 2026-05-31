"""Extract plain text from PDFs and convert to safe HTML for trip itineraries (Spiti-style layout)."""

from __future__ import annotations

import html
import re
from io import BytesIO

from pypdf import PdfReader

_PAGE_MARKER = re.compile(r"^--\s*\d+\s+of\s+\d+\s+--$", re.I)
_BULLET_START = re.compile(r"^[\-\*•·●\uf0b7]\s*")
_NUM_BULLET = re.compile(r"^\d+[\.\)]\s+")
_ONLY_BULLET = re.compile(r"^[\-\*•·●\uf0b7\s]+$")
_DAY_HEADING = re.compile(
  r"^day\s*\d+\s*[\-–—:]|^day\s*\d+\b",
  re.I,
)
_SECTION_HEADING = re.compile(
  r"^(trip\s+highlights?|highlights?|inclusions?|exclusions?|perfect\s+for|"
  r"package\s+options?|overview|summary|important\s+notes?|things\s+to\s+(?:carry|know)|"
  r"cost|pricing|brief\s+itinerary|detailed\s+itinerary|itinerary)\b",
  re.I,
)
_META_LINE = re.compile(
  r"\d+\s*days?\s*/\s*\d+\s*nights?|"
  r"\bto\s+\w+|\|.*\|.*|per\s+person|pickup|drop|dehradun|chandigarh|delhi",
  re.I,
)
_MIN_MEANINGFUL = 2


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
    text = page.extract_text() or ""
    if text.strip():
      chunks.append(text)

  raw = "\n".join(chunks)
  lines = _extract_lines(raw)
  if not lines:
    raise ValueError("no text could be extracted from this PDF")

  return _lines_to_itinerary_html(lines)


def _extract_lines(raw: str) -> list[str]:
  lines: list[str] = []
  for line in raw.splitlines():
    s = line.replace("\uf0b7", "•").strip()
    if not s or _PAGE_MARKER.match(s) or _ONLY_BULLET.match(s):
      continue
    if _BULLET_START.match(s) and not _meaningful(_strip_bullet(s)):
      continue
    lines.append(s)

  return _merge_wrapped_lines(lines)


def _meaningful(text: str) -> bool:
  core = re.sub(r"[\W_]+", "", text, flags=re.UNICODE)
  return len(core) >= _MIN_MEANINGFUL


def _strip_bullet(line: str) -> str:
  m = _NUM_BULLET.match(line)
  if m:
    return line[m.end() :].strip()
  m2 = _BULLET_START.match(line)
  if m2:
    return line[m2.end() :].strip()
  return line.strip()


def _is_bullet_line(line: str) -> bool:
  if _ONLY_BULLET.match(line):
    return False
  if not (_BULLET_START.match(line) or _NUM_BULLET.match(line)):
    return False
  return _meaningful(_strip_bullet(line))


def _is_day_heading(line: str) -> bool:
  return bool(_DAY_HEADING.match(line.strip()))


def _is_section_heading(line: str) -> bool:
  s = line.strip()
  if _SECTION_HEADING.match(s):
    return True
  letters = re.sub(r"[^A-Za-z\s]", "", s)
  if (
    len(s) >= 4
    and len(s) <= 55
    and s.upper() == s
    and len(letters) >= 4
    and " " in s
  ):
    return True
  if len(s) >= 6 and len(s) <= 40 and s.upper() == s and letters.isalpha():
    return True
  return False


def _is_meta_line(line: str) -> bool:
  return bool(_META_LINE.search(line))


def _starts_new_block(line: str) -> bool:
  return _is_day_heading(line) or _is_section_heading(line) or _is_bullet_line(line)


def _merge_wrapped_lines(lines: list[str]) -> list[str]:
  if not lines:
    return []

  merged: list[str] = []
  for line in lines:
    if not merged:
      merged.append(line)
      continue

    prev = merged[-1]
    if (
      _starts_new_block(line)
      or _is_meta_line(line)
      or _is_day_heading(line)
      or _is_section_heading(line)
    ):
      merged.append(line)
      continue

    if _is_bullet_line(prev):
      merged[-1] = f"{_strip_bullet(prev)} {line}".strip()
      continue

    if _is_meta_line(prev) or _is_day_heading(prev) or _is_section_heading(prev):
      merged.append(line)
      continue

    # Wrap long bullet/paragraph text only (not title + meta rows)
    if len(prev) > 90:
      merged[-1] = f"{prev} {line}".strip()
    else:
      merged.append(line)

  return [ln for ln in merged if _meaningful(ln) or _is_day_heading(ln)]


def _esc(line: str) -> str:
  return html.escape(line.strip(), quote=False)


def _lines_to_itinerary_html(lines: list[str]) -> str:
  out: list[str] = ['<section class="itinerary-block itinerary-block--pdf">']
  in_list = False
  title_set = False
  i = 0

  def close_list() -> None:
    nonlocal in_list
    if in_list:
      out.append("</ul>")
      in_list = False

  while i < len(lines):
    line = lines[i].strip()
    i += 1

    if not _meaningful(line) and not _is_day_heading(line):
      continue

    if _is_day_heading(line) or _is_section_heading(line):
      close_list()
      heading = line
      if not heading[0].isupper():
        heading = heading[:1].upper() + heading[1:]
      out.append(f"<h4>{_esc(heading)}</h4>")
      continue

    if _is_bullet_line(line):
      content = _strip_bullet(line)
      if not _meaningful(content):
        continue
      if not in_list:
        out.append("<ul>")
        in_list = True
      out.append(f"<li>{_esc(content)}</li>")
      continue

    close_list()

    if not title_set and len(line) < 120:
      out.append(f"<h4>{_esc(line)}</h4>")
      title_set = True
      if i < len(lines) and _is_meta_line(lines[i]):
        out.append(f'<p class="itinerary-meta">{_esc(lines[i].strip())}</p>')
        i += 1
      continue

    if _is_meta_line(line):
      out.append(f'<p class="itinerary-meta">{_esc(line)}</p>')
      continue

    if _is_section_heading(line):
      out.append(f"<h4>{_esc(line)}</h4>")
      continue

    out.append(f"<p>{_esc(line)}</p>")

  close_list()
  out.append("</section>")
  html_out = "\n".join(out)
  html_out = re.sub(r"<ul>\s*</ul>", "", html_out)
  html_out = re.sub(r"<li>\s*</li>", "", html_out)
  html_out = re.sub(r"<li>[•·●]\s*</li>", "", html_out)
  return html_out
