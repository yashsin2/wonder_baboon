/**
 * Travel Gallery — content config
 *
 * Defaults below are used when the API is offline. After admin edits in the
 * dashboard, data is loaded from GET /api/travel-gallery.
 */

import { API_BASE_URL } from "./config.js";

export type AdventureStatus = "completed" | "coming_soon";

export interface AdventureTestimonial {
  name: string;
  quote: string;
  avatar?: string;
}

export interface AdventureHighlight {
  title: string;
  image: string;
}

export interface AdventureVideo {
  /** Path under /assets/ or full URL */
  src: string;
  title: string;
  poster?: string;
}

export interface AdventureItineraryDay {
  title: string;
  items: string[];
}

export interface AdventureDestination {
  id: string;
  state: string;
  title: string;
  /** e.g. Jibhi backpacking trip — from catalogue itinerary */
  tripLabel?: string;
  tripMeta?: string;
  itineraryDays?: AdventureItineraryDay[];
  status: AdventureStatus;
  /** Pin position in SVG viewBox coords (612×696) — see india-map.ts */
  mapPin: { x: number; y: number };
  /** `id` on path in assets/india-map.svg */
  svgStateId?: string;
  /** Shown under state name on map pin, e.g. "Jun 2026" or "Coming Soon" */
  pinSubtitle?: string;
  dates?: string;
  travelers?: number;
  days?: number;
  photoCountLabel?: string;
  heroImage: string;
  photos: string[];
  highlights?: AdventureHighlight[];
  story?: string;
  testimonials?: AdventureTestimonial[];
  videos?: AdventureVideo[];
  /** Instagram / YouTube reel — opens in new tab when set */
  reelUrl?: string;
}

const HIMACHAL = "/assets/Himachal";

/** SVG viewBox 612×696. Nepal sits east of Uttarakhand, not in the empty Tibet band (y < 110). */
export const GALLERY_MAP_PINS: Record<string, { x: number; y: number }> = {
  himachal: { x: 172, y: 125 },
  uttarakhand: { x: 255, y: 138 },
  nepal: { x: 335, y: 185 },
  banaras: { x: 318, y: 255 },
  rajasthan: { x: 178, y: 268 },
  "north-east": { x: 492, y: 232 },
  goa: { x: 148, y: 508 },
  karnataka: { x: 228, y: 558 },
  kerala: { x: 212, y: 628 },
};

export function getGalleryMapPin(adv: AdventureDestination): { x: number; y: number } {
  return GALLERY_MAP_PINS[adv.id] ?? adv.mapPin;
}

export const GALLERY_HERO_OVERRIDES: Record<string, string> = {
  nepal: "/assets/nepal.jpg",
};

export function getGalleryHeroImage(adv: AdventureDestination): string {
  return GALLERY_HERO_OVERRIDES[adv.id] ?? adv.heroImage;
}

export let PREVIOUS_ADVENTURES: AdventureDestination[] = [
  {
    id: "himachal",
    state: "Himachal Pradesh",
    title: "Himachal Pradesh",
    tripLabel: "Jibhi backpacking trip",
    tripMeta: "4 days / 3 nights · Chandigarh to Chandigarh · ₹7,999 per person (indicative)",
    status: "completed",
    mapPin: { x: 172, y: 125 },
    svgStateId: "hp",
    pinSubtitle: "Jun 2026",
    dates: "18-21 June 2026",
    travelers: 18,
    days: 4,
    photoCountLabel: "250+",
    heroImage: `${HIMACHAL}/DSC04505.JPG`,
    photos: [
      `${HIMACHAL}/DSC04505.JPG`,
      `${HIMACHAL}/DSC04454.JPG`,
      `${HIMACHAL}/DSC04493.JPG`,
      `${HIMACHAL}/DSC04448.JPG`,
      `${HIMACHAL}/DSC04444.jpg`,
      `${HIMACHAL}/IMG_8871.JPG`,
    ],
    highlights: [
      { title: "Jalori Pass & Raghupur Fort", image: `${HIMACHAL}/DSC04454.JPG` },
      { title: "Bahu — YJHD Movie Spot", image: `${HIMACHAL}/DSC04493.JPG` },
      { title: "Jibhi Waterfall Walk", image: `${HIMACHAL}/DSC04448.JPG` },
      { title: "Bonfire Nights", image: `${HIMACHAL}/IMG_8871.JPG` },
    ],
    itineraryDays: [
      {
        title: "Day 1: Chandigarh → Jibhi",
        items: [
          "Early morning departure (05:00 – 06:00)",
          "Scenic drive via Bilaspur & Mandi",
          "Reach Jibhi by afternoon · mountain-view homestay check-in",
          "Evening: relax, bonfire, introductions & music",
        ],
      },
      {
        title: "Day 2: Jalori Pass + Raghupur Fort trek",
        items: [
          "Drive to Jalori Pass · trek to Raghupur Fort (~3 km, easy–moderate)",
          "Open meadows & Himalayan views",
          "Evening: return to stay, bonfire",
        ],
      },
      {
        title: "Day 3: Bahu — Yeh Jawaani Hai Deewani movie spot",
        items: [
          "Early breakfast · drive towards Bahu village",
          "The iconic YJHD trail — mountain views, café stops & photo walk",
          "Evening: bonfire & open mic",
        ],
      },
      {
        title: "Day 4: Jibhi sightseeing → Chandigarh",
        items: [
          "Breakfast & checkout",
          "Stops: Jibhi Waterfall, Mini Thailand Jibhi",
          "Depart for Chandigarh · arrive evening",
        ],
      },
    ],
    story:
      "18 strangers. 4 days. Countless conversations. From late night talks to sunrise walks, this trip gave us memories for life. ❤️",
    testimonials: [
      {
        name: "Ilma Ali",
        quote:
          "My first group trip with Wonder Baboon and Yash was genuinely one of the most comfortable travel experiences I've had. He was incredibly patient with everyone and handled everything so calmly. Our group had girls too, and he made sure we all felt safe and comfortable throughout. His entire team was kind, understanding, and supportive — you could tell they genuinely care. Yes, there were a few minor inconveniences, but Yash handled them like a pro and still made the trip feel perfect. He did things only someone with real experience could pull off.",
      },
      {
        name: "Tanish",
        quote:
          "I recently went on a trip to Jibhi with my group of six friends, organized by Wonder Baboon, and it was a really memorable experience. From the planning to the overall execution, everything was handled quite well. Of course, like any trip, we faced a few minor inconveniences along the way but nothing that took away from the fun or the overall experience. What really stood out was the effort the team put in to make sure we were comfortable and enjoying ourselves. A special mention to Yash — he is incredibly kind, helpful, and truly a gentleman. He made sure everything ran smoothly and was always approachable whenever we needed anything. Overall, we had an amazing time, created great memories, and I'd definitely recommend Wonder Baboon to anyone looking for a fun and well-organized trip.",
      },
      {
        name: "Kunal",
        quote:
          "My first trip with Wonder Baboon was honestly much better than I expected. The whole experience felt easy, comfortable, and well-managed. Yash was calm, approachable, and handled everything smoothly, which made it easy for everyone in the group to just enjoy the journey. What stood out the most was the positive vibe of the group and the effort put into making everyone feel included and comfortable. A few things didn't go exactly as planned, but they were managed so well that they never affected the overall experience. Looking forward to traveling with Wonder Baboon again.",
      },
      {
        name: "Hamza",
        quote:
          "I just want to say a huge thank you to the entire team for making this journey so memorable. From the very beginning, everyone was incredibly kind, supportive, and always ready to help. The level of care and attention they showed throughout the trip was truly commendable. A special shoutout to Yash, who handled everything so professionally and calmly. Even when there were a few ups and downs and unexpected challenges during the trip, he managed every situation perfectly and ensured that everyone remained comfortable and enjoyed the experience. His dedication, patience, and positive attitude made a huge difference. The trip was filled with beautiful moments, great coordination, lots of fun, and unforgettable memories. The team genuinely looked after every traveler and made sure no one felt left out. Thank you, Wonder Baboon, for such a fantastic adventure. I had an incredible time, met wonderful people, and created memories that I'll cherish forever. Already super excited and ready for my next trip with you all! Highly recommended to anyone looking for well-managed, fun-filled, and memorable travel experiences.",
      },
    ],
    videos: [],
    reelUrl: "",
  },
  {
    id: "uttarakhand",
    state: "Uttarakhand",
    title: "Uttarakhand",
    status: "coming_soon",
    mapPin: { x: 255, y: 138 },
    svgStateId: "ut",
    pinSubtitle: "Coming Soon",
    heroImage: "/assets/nagtibba3.jpg",
    photos: [],
  },
  {
    id: "nepal",
    state: "Nepal",
    title: "Nepal",
    status: "coming_soon",
    mapPin: { x: 335, y: 185 },
    pinSubtitle: "Coming Soon",
    heroImage: "/assets/nepal.jpg",
    photos: [],
  },
  {
    id: "banaras",
    state: "Banaras",
    title: "Banaras · Uttar Pradesh",
    status: "coming_soon",
    mapPin: { x: 318, y: 255 },
    svgStateId: "up",
    pinSubtitle: "Coming Soon",
    heroImage: "/assets/banaras.jpg",
    photos: [],
  },
  {
    id: "rajasthan",
    state: "Rajasthan",
    title: "Rajasthan",
    status: "coming_soon",
    mapPin: { x: 178, y: 268 },
    svgStateId: "rj",
    pinSubtitle: "Coming Soon",
    heroImage: "/assets/aditya-siva-6rDbvXzIVpQ-unsplash.jpg",
    photos: [],
  },
  {
    id: "north-east",
    state: "North East",
    title: "North East India",
    status: "coming_soon",
    mapPin: { x: 492, y: 232 },
    svgStateId: "as",
    pinSubtitle: "Coming Soon",
    heroImage: "/assets/utkarsh-b-PNrVnDB1dPQ-unsplash.jpg",
    photos: [],
  },
  {
    id: "goa",
    state: "Goa",
    title: "Goa",
    status: "coming_soon",
    mapPin: { x: 148, y: 508 },
    svgStateId: "ga",
    pinSubtitle: "Coming Soon",
    heroImage: "/assets/alexey-turenkov-bWJiSZjIgTM-unsplash.jpg",
    photos: [],
  },
  {
    id: "karnataka",
    state: "Karnataka",
    title: "Karnataka",
    status: "coming_soon",
    mapPin: { x: 228, y: 558 },
    svgStateId: "ka",
    pinSubtitle: "Coming Soon",
    heroImage: "/assets/srusti-valakamadinni-I_8I75ogzkE-unsplash.jpg",
    photos: [],
  },
  {
    id: "kerala",
    state: "Kerala",
    title: "Kerala",
    status: "coming_soon",
    mapPin: { x: 212, y: 628 },
    svgStateId: "kl",
    pinSubtitle: "Coming Soon",
    heroImage: "/assets/nature-photographer-29ezCWtMtnM-unsplash.jpg",
    photos: [],
  },
];

function normalizeDestination(raw: AdventureDestination): AdventureDestination {
  return {
    ...raw,
    photos: raw.photos ?? [],
    testimonials: raw.testimonials ?? [],
    highlights: raw.highlights ?? [],
    videos: raw.videos ?? [],
  };
}

/** Load gallery from API (admin-managed). Falls back to defaults on failure. */
export async function loadTravelGalleryFromApi(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/travel-gallery`);
    if (!res.ok) return false;
    const data = (await res.json()) as { destinations?: AdventureDestination[] };
    if (Array.isArray(data.destinations) && data.destinations.length > 0) {
      PREVIOUS_ADVENTURES = data.destinations.map(normalizeDestination);
      return true;
    }
  } catch {
    /* offline — keep bundled defaults */
  }
  return false;
}

export function getAdventureById(id: string): AdventureDestination | undefined {
  const key = id.trim().toLowerCase();
  return PREVIOUS_ADVENTURES.find((a) => a.id === key);
}

/** Completed trips only — for home page featured section */
export function getCompletedAdventures(): AdventureDestination[] {
  return PREVIOUS_ADVENTURES.filter((a) => a.status === "completed");
}
