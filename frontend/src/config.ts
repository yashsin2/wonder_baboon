import type { TripStyleSlug } from "./trip-styles.js";

export type { TripStyleSlug } from "./trip-styles.js";

const ENV_API_BASE = (window as unknown as { __WB_API_BASE__?: string }).__WB_API_BASE__;
/** Direct VPS IP in browser bar (legacy) */
const SERVER_HOSTS = new Set(["72.60.200.102", ""]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", ""]);
const PRODUCTION_WEB_HOSTS = new Set(["wonderbaboon.com", "www.wonderbaboon.com"]);
const PUBLIC_API_BASE = "https://api.wonderbaboon.com/api";

/** e.g. open site at http://192.168.1.10:3000 — API on same machine at :5051 */
function isPrivateLanIPv4(hostname: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  return false;
}

function resolveApiBase(): string {
  if (ENV_API_BASE) return ENV_API_BASE.replace(/\/$/, "");
  const { protocol, hostname } = window.location;
  if (LOCAL_HOSTS.has(hostname)) {
    return "http://localhost:5051/api";
  }
  if (isPrivateLanIPv4(hostname)) {
    return `${protocol}//${hostname}:5051/api`;
  }
  if (PRODUCTION_WEB_HOSTS.has(hostname) || SERVER_HOSTS.has(hostname)) {
    return PUBLIC_API_BASE;
  }
  return `${protocol}//${hostname}/api`;
}

export const API_BASE_URL = resolveApiBase();

/** Canonical paths (no .html) — use for links and redirects */
export const ROUTES = {
  home: "/",
  auth: "/auth",
  upcoming: "/upcoming-trips",
  previous: "/previous-trips",
  settings: "/settings",
  admin: "/admin-dashboard",
} as const;

export const logger = {
  info: (...args: unknown[]) => console.info("[wb]", ...args),
  warn: (...args: unknown[]) => console.warn("[wb]", ...args),
  error: (...args: unknown[]) => console.error("[wb]", ...args),
};

export interface SessionUser {
  name?: string;
  email?: string;
  mobile?: string;
  role: "user" | "admin";
  username?: string;
}

export interface Trip {
  _id: string;
  title: string;
  location: string;
  durationLabel: string;
  price: number;
  startDate: string;
  endDate?: string;
  imageUrl?: string;
  /** From DB when admin uploads a PDF itinerary */
  itineraryHtml?: string;
  /** Backpackers / Motorcycle Diaries / etc. — see trip-styles.ts */
  tripStyle?: TripStyleSlug;
}

export interface Booking {
  _id: string;
  travelDestination: string;
  tripType: "defined_trip" | "planned_trip";
  dateOfTravel: string;
  numberOfPeople: number;
  createdAt: string;
  fullName?: string;
  mobile?: string;
  email?: string;
  tripId?: string;
  /** Lead + additional travelers in order (when stored by newer bookings) */
  travelers?: string[];
  /** Copied from packaged trip when tripId is set and trip has custom itinerary */
  itineraryHtml?: string;
  /** Admin-settlement; unset treated as unpaid for user messaging */
  payment?: string;
  /** Filled after admin confirms with advance + totals */
  packageTotalInr?: number;
  advancePaymentInr?: number;
  balanceDueInr?: number;
}

export function getSession(): { token: string | null; user: SessionUser | null } {
  const token = localStorage.getItem("wb_token");
  const raw = localStorage.getItem("wb_user");
  const user = raw ? (JSON.parse(raw) as SessionUser) : null;
  return { token, user };
}

export function saveSession(token: string, user: SessionUser): void {
  localStorage.setItem("wb_token", token);
  localStorage.setItem("wb_user", JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem("wb_token");
  localStorage.removeItem("wb_user");
}

export function normalizeImageUrl(url?: string): string {
  if (!url) return "./assets/lake.jpg";
  if (url.startsWith("./assets/") || url.startsWith("assets/")) {
    return url.startsWith("./") ? url : `./${url}`;
  }
  return `./assets/${url.split("/").pop()}`;
}

export function updateHeaderAuth(): void {
  const greeting = document.getElementById("logoGreeting");
  const { token, user } = getSession();
  if (!greeting) return;

  if (token && user?.role === "user") {
    const label = user.name || user.email || "Traveler";
    greeting.textContent = `Hi, ${label}`;
    greeting.style.display = "block";
  } else if (token && user?.role === "admin") {
    greeting.textContent = "Admin";
    greeting.style.display = "block";
  } else {
    greeting.textContent = "";
    greeting.style.display = "none";
  }
}

export function smoothScrollToAnchor(href: string): void {
  if (!href.startsWith("#")) return;
  const id = href.slice(1);
  if (!id) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const el = document.getElementById(id);
  if (!el) return;
  const headerOffset = 70;
  const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
  window.scrollTo({ top, behavior: "smooth" });
}

export function attachSmoothScroll(scope: ParentNode = document): void {
  scope.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (event) => {
      const href = a.getAttribute("href") || "";
      if (href.length <= 1) return;
      event.preventDefault();
      smoothScrollToAnchor(href);
    });
  });
}

export function showMessagePopup(message: string, type: "success" | "error" = "success"): void {
  const el = document.createElement("div");
  el.className = `notification ${type} show`;
  const plain = message.replace(/\s+/g, " ").trim();
  const short =
    plain.length > 120 || plain.includes("\n")
      ? `${plain.slice(0, 117)}…`
      : plain;
  const safeBody = short
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  el.innerHTML = `
    <span>${safeBody}</span>
    <button type="button" class="close-note" aria-label="Close">&times;</button>
  `;
  document.body.appendChild(el);
  const remove = (): void => el.remove();
  el.querySelector(".close-note")?.addEventListener("click", remove);
  setTimeout(remove, 4500);
}

export function showSuccessModal(title: string, message: string, ctaLabel = "Great!"): void {
  document.getElementById("wbSuccessModal")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "wbSuccessModal";
  wrap.className = "wb-modal";
  wrap.innerHTML = `
    <div class="wb-modal-card wb-success-card">
      <div class="wb-success-icon">✓</div>
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="wb-modal-actions">
        <button type="button" class="wb-primary" id="wbSuccessOk">${ctaLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("#wbSuccessOk")?.addEventListener("click", close);
  wrap.addEventListener("click", (event) => {
    if (event.target === wrap) close();
  });
}

export async function parseError(response: Response, data?: unknown): Promise<string> {
  const serviceUnavailable =
    "We can't reach our servers right now. Please try again in a few minutes.";
  const serverError = "Something went wrong on our side. Please try again later.";

  let body: unknown = data;
  if (body === undefined) {
    const text = await response.text().catch(() => "");
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      if (response.status === 503) return serviceUnavailable;
      if (response.status >= 500) return serverError;
      const t = text.trim();
      if (t.startsWith("<") || t.toLowerCase().includes("<!doctype")) {
        return "Could not read server data (received a web page instead). Try Ctrl+Shift+R to reload without cache, or try again in a private/incognito window.";
      }
      return t ? `Something went wrong (${response.status}).` : `Request failed (${response.status})`;
    }
  }

  const obj = body as Record<string, unknown>;
  const detail = obj.detail;

  if (typeof detail === "string") {
    if (response.status === 503 || /database|mongo|mongodb|mongo_uri/i.test(detail)) {
      return serviceUnavailable;
    }
    return detail;
  }

  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "msg" in item) {
        return String((item as { msg?: string; type?: string }).msg || "Invalid input");
      }
      return "Invalid input";
    });
    const joined = parts.filter(Boolean).join(", ");
    if (joined) return joined;
    return response.status >= 500 ? serverError : "Request failed";
  }

  if (detail && typeof detail === "object" && "msg" in detail) {
    return String((detail as { msg?: string }).msg || "Request failed");
  }

  if (response.status === 503) return serviceUnavailable;
  if (response.status >= 500) return serverError;
  return "Request failed";
}

export function parseTravelDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function isUpcomingTravelDate(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseTravelDate(dateStr) >= today;
}
