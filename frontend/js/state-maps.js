/**
 * District maps (assets/maps/<code>.svg + manifest.json, built by scripts/build_state_maps.py).
 * Shared by the public Travel Gallery and the admin. A place is stored as lat/lng; the manifest holds the
 * linear projection used to draw it on the map and to turn an admin click back into lat/lng.
 */
let manifestPromise = null;
const svgCache = new Map();
export function loadStateMapManifest() {
    if (!manifestPromise) {
        manifestPromise = fetch("/assets/maps/manifest.json")
            .then((res) => {
            if (!res.ok)
                throw new Error("district maps not available");
            return res.json();
        })
            .catch(() => {
            manifestPromise = null;
            return {};
        });
    }
    return manifestPromise;
}
export async function getStateMapMeta(code) {
    if (!code)
        return null;
    const manifest = await loadStateMapManifest();
    return manifest[code] ?? null;
}
export function loadStateMapSvg(meta) {
    let p = svgCache.get(meta.file);
    if (!p) {
        p = fetch(`/assets/maps/${meta.file}`).then((res) => {
            if (!res.ok)
                throw new Error("could not load district map");
            return res.text();
        });
        svgCache.set(meta.file, p);
        p.catch(() => svgCache.delete(meta.file));
    }
    return p;
}
export function projectLatLng(meta, lat, lng) {
    return { x: (lng - meta.proj.lon0) * meta.proj.kx, y: (meta.proj.lat0 - lat) * meta.proj.ky };
}
export function unprojectXY(meta, x, y) {
    return { lat: meta.proj.lat0 - y / meta.proj.ky, lng: meta.proj.lon0 + x / meta.proj.kx };
}
export function districtName(meta, id) {
    if (!id)
        return "";
    return meta?.districts.find((d) => d.id === id)?.name ?? id;
}
/** Inject the district SVG into `host` and tag it for styling. Returns the <svg>. */
export async function mountStateMap(host, meta) {
    host.innerHTML = await loadStateMapSvg(meta);
    const svg = host.querySelector("svg");
    if (!svg)
        return null;
    svg.classList.add("wb-state-svg");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return svg;
}
/** Convert a pointer event on the SVG into map units (the viewBox coordinate space). */
export function eventToMapXY(svg, event) {
    const ctm = svg.getScreenCTM();
    if (!ctm)
        return null;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
}
/** Which district id contains this event target (if any). */
export function districtFromTarget(target) {
    return target?.closest?.("[data-district]")?.getAttribute("data-district") ?? null;
}
/** Shared map styling hooks (colours live in CSS: .wb-state-svg ...). */
export function markDistricts(svg, counts, selected) {
    svg.querySelectorAll(".wb-districts [data-district]").forEach((path) => {
        const id = path.getAttribute("data-district") ?? "";
        path.classList.toggle("has-trips", (counts[id] ?? 0) > 0);
        path.classList.toggle("is-selected", id === selected);
        path.classList.toggle("is-dim", selected !== null && id !== selected);
    });
}
