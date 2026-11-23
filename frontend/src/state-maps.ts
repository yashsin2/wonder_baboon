/**
 * District maps (assets/maps/<code>.svg + manifest.json, built by scripts/build_state_maps.py).
 * Shared by the public Travel Gallery and the admin. A place is stored as lat/lng; the manifest holds the
 * linear projection used to draw it on the map and to turn an admin click back into lat/lng.
 */

export type DistrictMeta = { id: string; name: string; cx: number; cy: number };

export type StateMapMeta = {
  name: string;
  file: string;
  w: number;
  h: number;
  proj: { lon0: number; lat0: number; kx: number; ky: number };
  districts: DistrictMeta[];
};

let manifestPromise: Promise<Record<string, StateMapMeta>> | null = null;
const svgCache = new Map<string, Promise<string>>();

export function loadStateMapManifest(): Promise<Record<string, StateMapMeta>> {
  if (!manifestPromise) {
    manifestPromise = fetch("/assets/maps/manifest.json")
      .then((res) => {
        if (!res.ok) throw new Error("district maps not available");
        return res.json() as Promise<Record<string, StateMapMeta>>;
      })
      .catch(() => {
        manifestPromise = null;
        return {} as Record<string, StateMapMeta>;
      });
  }
  return manifestPromise;
}

export async function getStateMapMeta(code: string | undefined): Promise<StateMapMeta | null> {
  if (!code) return null;
  const manifest = await loadStateMapManifest();
  return manifest[code] ?? null;
}

export function loadStateMapSvg(meta: StateMapMeta): Promise<string> {
  let p = svgCache.get(meta.file);
  if (!p) {
    p = fetch(`/assets/maps/${meta.file}`).then((res) => {
      if (!res.ok) throw new Error("could not load district map");
      return res.text();
    });
    svgCache.set(meta.file, p);
    p.catch(() => svgCache.delete(meta.file));
  }
  return p;
}

export function projectLatLng(meta: StateMapMeta, lat: number, lng: number): { x: number; y: number } {
  return { x: (lng - meta.proj.lon0) * meta.proj.kx, y: (meta.proj.lat0 - lat) * meta.proj.ky };
}

export function unprojectXY(meta: StateMapMeta, x: number, y: number): { lat: number; lng: number } {
  return { lat: meta.proj.lat0 - y / meta.proj.ky, lng: meta.proj.lon0 + x / meta.proj.kx };
}

export function districtName(meta: StateMapMeta | null, id: string | undefined): string {
  if (!id) return "";
  return meta?.districts.find((d) => d.id === id)?.name ?? id;
}

/** Inject the district SVG into `host` and tag it for styling. Returns the <svg>. */
export async function mountStateMap(host: HTMLElement, meta: StateMapMeta): Promise<SVGSVGElement | null> {
  host.innerHTML = await loadStateMapSvg(meta);
  const svg = host.querySelector("svg");
  if (!svg) return null;
  svg.classList.add("wb-state-svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return svg;
}

/** Convert a pointer event on the SVG into map units (the viewBox coordinate space). */
export function eventToMapXY(svg: SVGSVGElement, event: MouseEvent): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

/** Which district id contains this event target (if any). */
export function districtFromTarget(target: EventTarget | null): string | null {
  return (target as Element | null)?.closest?.("[data-district]")?.getAttribute("data-district") ?? null;
}

/** Shared map styling hooks (colours live in CSS: .wb-state-svg ...). */
export function markDistricts(
  svg: SVGSVGElement,
  counts: Record<string, number>,
  selected: string | null
): void {
  svg.querySelectorAll<SVGPathElement>(".wb-districts [data-district]").forEach((path) => {
    const id = path.getAttribute("data-district") ?? "";
    path.classList.toggle("has-trips", (counts[id] ?? 0) > 0);
    path.classList.toggle("is-selected", id === selected);
    path.classList.toggle("is-dim", selected !== null && id !== selected);
  });
}
