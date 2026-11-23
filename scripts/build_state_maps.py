#!/usr/bin/env python3
"""Build per-state district maps for the Travel Gallery.

Source: https://github.com/udit-001/india-maps-data (district GeoJSON per state, 2011 census boundaries).
Output: frontend/assets/maps/<code>.svg  +  frontend/assets/maps/manifest.json

The manifest stores a simple linear projection per state, so a place saved as lat/lng can be drawn on the
map (and an admin click on the map can be turned back into lat/lng):
    x = (lng - lon0) * kx        y = (lat0 - lat) * ky

Usage:  python3 scripts/build_state_maps.py [cache_dir]
Only needs the Python standard library.
"""
import json
import math
import re
import sys
import urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/states/{}.geojson"
OUT = Path(__file__).resolve().parents[1] / "frontend" / "assets" / "maps"

# svg state id used by assets/india-map.svg  ->  file name in the source repo
STATES = {
  "an": "andaman-and-nicobar-islands", "ap": "andhra-pradesh", "ar": "arunachal-pradesh", "as": "assam",
  "br": "bihar", "ch": "chandigarh", "ct": "chhattisgarh", "dn": "dnh-and-dd", "dl": "delhi", "ga": "goa",
  "gj": "gujarat", "hr": "haryana", "hp": "himachal-pradesh", "jk": "jammu-and-kashmir", "jh": "jharkhand",
  "ka": "karnataka", "kl": "kerala", "ld": "ladakh", "mp": "madhya-pradesh", "mh": "maharashtra",
  "mn": "manipur", "ml": "meghalaya", "mz": "mizoram", "nl": "nagaland", "or": "odisha", "py": "puducherry",
  "pb": "punjab", "rj": "rajasthan", "sk": "sikkim", "tn": "tamil-nadu", "tg": "telangana", "tr": "tripura",
  "up": "uttar-pradesh", "ut": "uttarakhand", "wb": "west-bengal",
}
SIZE = 1000.0     # long side of each state map, in SVG units
PAD = 14.0
TOLERANCE = 0.9   # Douglas-Peucker tolerance, in SVG units


def slug(text):
  return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def dp(points, eps):
  """Iterative Douglas-Peucker for a list of (x, y)."""
  n = len(points)
  if n < 4:
    return points
  keep = [False] * n
  keep[0] = keep[-1] = True
  stack = [(0, n - 1)]
  while stack:
    a, b = stack.pop()
    ax, ay = points[a]
    bx, by = points[b]
    dx, dy = bx - ax, by - ay
    norm = math.hypot(dx, dy) or 1e-9
    best, idx = 0.0, -1
    for i in range(a + 1, b):
      px, py = points[i]
      d = abs(dy * (px - ax) - dx * (py - ay)) / norm
      if d > best:
        best, idx = d, i
    if best > eps and idx > 0:
      keep[idx] = True
      stack.append((a, idx))
      stack.append((idx, b))
  return [p for p, k in zip(points, keep) if k]


def simplify_ring(points, eps):
  """Closed rings: split at the point farthest from the start so Douglas-Peucker has a real baseline."""
  if len(points) < 5:
    return points
  if points[0] == points[-1]:
    points = points[:-1]
  x0, y0 = points[0]
  far = max(range(len(points)), key=lambda i: (points[i][0] - x0) ** 2 + (points[i][1] - y0) ** 2)
  first = dp(points[: far + 1], eps)
  second = dp(points[far:] + [points[0]], eps)
  return first[:-1] + second[:-1]


def rings_of(geom):
  if geom["type"] == "Polygon":
    return [geom["coordinates"]]
  if geom["type"] == "MultiPolygon":
    return geom["coordinates"]
  return []


def ring_area_centroid(ring):
  a = cx = cy = 0.0
  for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
    c = x0 * y1 - x1 * y0
    a += c
    cx += (x0 + x1) * c
    cy += (y0 + y1) * c
  if abs(a) < 1e-9:
    return 0.0, ring[0][0], ring[0][1]
  return a / 2, cx / (3 * a), cy / (3 * a)


def load(code, name, cache):
  cache.mkdir(parents=True, exist_ok=True)
  path = cache / f"{name}.geojson"
  if not path.exists():
    print("  downloading", name)
    with urllib.request.urlopen(RAW.format(name), timeout=60) as r:
      path.write_bytes(r.read())
  return json.loads(path.read_text(encoding="utf-8"))


def build(code, name, cache):
  data = load(code, name, cache)
  feats = [f for f in data["features"] if f.get("geometry")]
  lons = [p[0] for f in feats for poly in rings_of(f["geometry"]) for ring in poly for p in ring]
  lats = [p[1] for f in feats for poly in rings_of(f["geometry"]) for ring in poly for p in ring]
  min_lon, max_lon, min_lat, max_lat = min(lons), max(lons), min(lats), max(lats)
  cos_mid = math.cos(math.radians((min_lat + max_lat) / 2))
  span_x, span_y = (max_lon - min_lon) * cos_mid, (max_lat - min_lat)
  scale = SIZE / max(span_x, span_y)
  ky, kx = scale, scale * cos_mid
  lon0 = min_lon - PAD / kx
  lat0 = max_lat + PAD / ky
  width = round((max_lon - min_lon) * kx + 2 * PAD, 1)
  height = round((max_lat - min_lat) * ky + 2 * PAD, 1)

  def proj(lon, lat):
    return ((lon - lon0) * kx, (lat0 - lat) * ky)

  districts, paths, outline, seen = [], [], [], set()
  for f in sorted(feats, key=lambda f: str(f["properties"].get("district", ""))):
    dname = str(f["properties"].get("district") or f["properties"].get("dtname") or "District").strip()
    did = slug(dname) or "district"
    if did in seen:
      did = f"{did}-{slug(str(f['properties'].get('dt_code', len(seen))))}"
    seen.add(did)
    d, best = [], (-1.0, 0.0, 0.0)
    for poly in rings_of(f["geometry"]):
      for ring in poly:
        pts = [proj(lon, lat) for lon, lat in [(p[0], p[1]) for p in ring]]
        simple = simplify_ring(pts, TOLERANCE)
        if len(simple) < 3:
          continue
        d.append("M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in simple) + "Z")
      outer = [proj(p[0], p[1]) for p in poly[0]]
      area, cx, cy = ring_area_centroid(outer)
      if abs(area) > best[0]:
        best = (abs(area), cx, cy)
    if not d:
      continue
    dd = "".join(d)
    paths.append('<path class="wb-district" id="d-%s" data-district="%s" data-name="%s" d="%s"/>' % (did, did, dname, dd))
    outline.append('<path d="%s"/>' % dd)
    districts.append({"id": did, "name": dname, "cx": round(best[1], 1), "cy": round(best[2], 1)})

  svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" role="img" aria-label="District map">' % (width, height)
    + '<g class="wb-outline" fill="none" stroke-linejoin="round">' + "".join(outline) + "</g>"
    + '<g class="wb-districts">' + "".join(paths) + "</g></svg>"
  )
  (OUT / f"{code}.svg").write_text(svg, encoding="utf-8")
  return {
    "name": name.replace("-", " ").title(),
    "file": f"{code}.svg",
    "w": width,
    "h": height,
    "proj": {"lon0": round(lon0, 5), "lat0": round(lat0, 5), "kx": round(kx, 4), "ky": round(ky, 4)},
    "districts": districts,
  }


def main():
  cache = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/wb-state-geojson")
  OUT.mkdir(parents=True, exist_ok=True)
  manifest = {}
  for code, name in STATES.items():
    print(code, name)
    manifest[code] = build(code, name, cache)
  (OUT / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
  total = sum(p.stat().st_size for p in OUT.glob("*"))
  print(f"done: {len(manifest)} states, {total/1024:.0f} KB")


if __name__ == "__main__":
  main()
