/** @svg-maps/india viewBox */
export const INDIA_MAP_VIEWBOX = { width: 612, height: 696 };
/** Map pin position in SVG viewBox units (612×696) */
export function pinToPercent(x, y) {
    return {
        left: (x / INDIA_MAP_VIEWBOX.width) * 100,
        top: (y / INDIA_MAP_VIEWBOX.height) * 100,
    };
}
/** Path `id` in assets/india-map.svg — used to highlight state on hover/select */
export const ADVENTURE_SVG_STATE_IDS = {
    himachal: "hp",
    uttarakhand: "ut",
    banaras: "up",
    rajasthan: "rj",
    "north-east": "as",
    goa: "ga",
    karnataka: "ka",
    kerala: "kl",
};
export async function mountIndiaMap(host) {
    const res = await fetch("/assets/india-map.svg");
    if (!res.ok)
        throw new Error("Could not load India map");
    const text = await res.text();
    host.innerHTML = text;
    const svg = host.querySelector("svg");
    if (!svg)
        return null;
    svg.classList.add("adv-india-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Interactive map of India");
    svg.querySelectorAll("path").forEach((path) => {
        path.classList.add("adv-india-state");
        if (path.id === "an") {
            path.classList.add("adv-india-state--islands");
        }
    });
    return svg;
}
export function setHighlightedState(svg, stateId) {
    if (!svg)
        return;
    svg.querySelectorAll(".adv-india-state").forEach((path) => {
        path.classList.toggle("is-highlighted", stateId !== null && path.id === stateId);
        path.classList.toggle("is-dimmed", stateId !== null && path.id !== stateId && path.id !== "an");
    });
}
