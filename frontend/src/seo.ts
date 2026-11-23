/**
 * Runtime SEO helpers: structured data (JSON-LD) built from live data, and page title/description updates.
 * Static metadata (canonical, Open Graph, base JSON-LD) is written into each page by scripts/apply_seo.py.
 */
import type { Trip } from "./config.js";
import { normalizeImageUrl } from "./config.js";
import { TRIP_STYLES, normalizeTripStyle } from "./trip-styles.js";

/** Always the production origin, so JSON-LD is right even when browsing localhost or a preview. */
export const SITE_ORIGIN = "https://wonderbaboon.com";
const ORG_ID = `${SITE_ORIGIN}/#organization`;

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_ORIGIN}/${path.replace(/^\.?\//, "")}`;
}

/** Insert or replace a <script type="application/ld+json" id="…">. */
export function setJsonLd(id: string, data: unknown): void {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

function setMeta(selector: string, attr: "content", value: string, create?: { name?: string; property?: string }): void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el && create) {
    el = document.createElement("meta");
    if (create.name) el.setAttribute("name", create.name);
    if (create.property) el.setAttribute("property", create.property);
    document.head.appendChild(el);
  }
  el?.setAttribute(attr, value);
}

/** Update <title> and the description / social tags (used when a deep-link view changes what the page is about). */
export function setPageSeo(title: string, description?: string): void {
  document.title = title;
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[name="twitter:title"]', "content", title);
  if (description) {
    const d = description.length > 158 ? `${description.slice(0, 155).trimEnd()}…` : description;
    setMeta('meta[name="description"]', "content", d, { name: "description" });
    setMeta('meta[property="og:description"]', "content", d);
    setMeta('meta[name="twitter:description"]', "content", d);
  }
}

/** Upcoming trips → schema.org Event list (dates, price, location) so they can qualify for event rich results. */
export function tripsToJsonLd(trips: Trip[], pageUrl: string, listName: string): unknown {
  const items = trips
    .filter((t) => t.startDate && Number.isFinite(Number(t.price)))
    .map((t, i) => {
      const style = TRIP_STYLES[normalizeTripStyle(t.tripStyle)];
      const start = String(t.startDate).slice(0, 10);
      const end = String(t.endDate || t.startDate).slice(0, 10);
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Event",
          name: t.title,
          description: `${t.durationLabel} ${style.shortLabel.toLowerCase()} group trip to ${t.location}, organised by Wonder Baboon.`,
          startDate: start,
          endDate: end,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          location: {
            "@type": "Place",
            name: t.location,
            address: { "@type": "PostalAddress", addressLocality: t.location, addressCountry: "IN" },
          },
          image: [absoluteUrl(normalizeImageUrl(t.imageUrl))],
          organizer: { "@id": ORG_ID },
          offers: {
            "@type": "Offer",
            price: Number(t.price),
            priceCurrency: "INR",
            url: pageUrl,
            validFrom: new Date().toISOString().slice(0, 10),
          },
          url: pageUrl,
        },
      };
    });
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    itemListElement: items,
  };
}

type GalleryPlaceLike = {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  area?: string;
  heroImage?: string;
  lat?: number;
  lng?: number;
};
type GalleryStateLike = { state: string; places?: GalleryPlaceLike[] };

/** Travel Gallery places → TouristAttraction list with coordinates. */
export function galleryToJsonLd(states: GalleryStateLike[]): unknown {
  const items: unknown[] = [];
  states.forEach((s) =>
    (s.places ?? []).forEach((p) => {
      const place: Record<string, unknown> = {
        "@type": "TouristAttraction",
        name: p.name,
        description: p.description || p.tagline || `${p.name}${p.area ? `, ${p.area}` : ""} in ${s.state} — visited on a Wonder Baboon group trip.`,
        containedInPlace: { "@type": "AdministrativeArea", name: s.state },
        touristType: "Group travellers",
      };
      if (typeof p.lat === "number" && typeof p.lng === "number") {
        place.geo = { "@type": "GeoCoordinates", latitude: p.lat, longitude: p.lng };
      }
      if (p.heroImage) place.image = absoluteUrl(p.heroImage);
      items.push({ "@type": "ListItem", position: items.length + 1, item: place });
    })
  );
  return { "@context": "https://schema.org", "@type": "ItemList", name: "Places visited on Wonder Baboon group trips", itemListElement: items };
}
