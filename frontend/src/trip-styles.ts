export type TripStyleSlug =
  | "backpackers"
  | "motorcycle_diaries"
  | "dolce_far_niente"
  | "hikers";

export interface TripStyleConfig {
  slug: TripStyleSlug;
  title: string;
  shortLabel: string;
  tagline: string;
  quote: string;
  quoteAttribution: string;
  description: string;
  cssClass: string;
}

export const TRIP_STYLE_ORDER: TripStyleSlug[] = [
  "backpackers",
  "motorcycle_diaries",
  "dolce_far_niente",
  "hikers",
];

export const TRIP_STYLES: Record<TripStyleSlug, TripStyleConfig> = {
  backpackers: {
    slug: "backpackers",
    title: "The Backpackers",
    shortLabel: "Backpackers",
    tagline: "Dorm beds, dawn buses, stories worth more than souvenirs.",
    quote: "Not all those who wander are lost.",
    quoteAttribution: "J.R.R. Tolkien",
    description:
      "For travelers who chase value over velvet — shared rides, hostel laughs, street food feasts, and routes that keep your wallet light and your backpack full of stories.",
    cssClass: "style-backpackers",
  },
  motorcycle_diaries: {
    slug: "motorcycle_diaries",
    title: "The Motorcycle Diaries",
    shortLabel: "Motorcycle Diaries",
    tagline: "Open road. Dust in your teeth. Freedom on two wheels.",
    quote:
      "I now know, by an almost fatalistic conformity with the facts, that my destiny is to travel.",
    quoteAttribution: "Che Guevara, The Motorcycle Diaries",
    description:
      "Inspired by the legendary ride across South America — motorcycle expeditions, mountain passes, campfire nights, and the raw thrill of the open highway. Not a tour bus. A revolution on wheels.",
    cssClass: "style-motorcycle",
  },
  dolce_far_niente: {
    slug: "dolce_far_niente",
    title: "Dolce far niente",
    shortLabel: "Dolce far niente",
    tagline: "The sweetness of doing nothing — beautifully.",
    quote: "Dolce far niente — the sweetness of doing nothing.",
    quoteAttribution: "Italian proverb",
    description:
      "For souls who travel to breathe, not race. Slow mornings, chai by the river, sunsets without alarms, and trips designed for rest, reflection, and gentle wonder.",
    cssClass: "style-dolce",
  },
  hikers: {
    slug: "hikers",
    title: "The Hikers",
    shortLabel: "The Hikers",
    tagline: "Summits, switchbacks, and the view that makes it worth it.",
    quote: "The mountains are calling and I must go.",
    quoteAttribution: "John Muir",
    description:
      "Trekking trails, alpine camps, ridge walks, and peak-bagging adventures for legs that love elevation and hearts that love the climb.",
    cssClass: "style-hikers",
  },
};

export function normalizeTripStyle(raw?: string | null): TripStyleSlug {
  const slug = (raw || "").trim().toLowerCase();
  if (slug in TRIP_STYLES) return slug as TripStyleSlug;
  return "backpackers";
}

export function tripStylePageHref(slug: TripStyleSlug): string {
  return TRIP_STYLE_PATHS[slug];
}

/** @deprecated use tripStylePageHref */
export function tripStylePanelHref(slug: TripStyleSlug): string {
  return tripStylePageHref(slug);
}

export const TRIP_STYLE_PATHS: Record<TripStyleSlug, string> = {
  backpackers: "/backpackers",
  motorcycle_diaries: "/motorcycle-diaries",
  dolce_far_niente: "/dolce-far-niente",
  hikers: "/hikers",
};

export function tripStyleSlugFromPath(pathname: string): TripStyleSlug | null {
  const p = pathname.replace(/\/$/, "") || "/";
  for (const slug of TRIP_STYLE_ORDER) {
    if (TRIP_STYLE_PATHS[slug] === p) return slug;
  }
  return null;
}

export function renderStyleIntroHtml(style: TripStyleConfig): string {
  return `
    <blockquote class="style-intro-quote">"${style.quote}"</blockquote>
    <p class="style-intro-attribution">— ${style.quoteAttribution}</p>
    <p class="style-intro-desc">${style.description}</p>`;
}
