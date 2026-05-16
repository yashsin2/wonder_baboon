const ENV_API_BASE = (window as unknown as { __WB_API_BASE__?: string }).__WB_API_BASE__;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", ""]);

function resolveApiBase(): string {
  if (ENV_API_BASE) return ENV_API_BASE.replace(/\/$/, "");
  const { protocol, hostname } = window.location;
  if (LOCAL_HOSTS.has(hostname)) {
    return "http://localhost:5051/api";
  }
  return `${protocol}//${hostname}/api`;
}

export const API_BASE_URL = resolveApiBase();

export const logger = {
  info: (...args: unknown[]) => console.info("[wb]", ...args),
  warn: (...args: unknown[]) => console.warn("[wb]", ...args),
  error: (...args: unknown[]) => console.error("[wb]", ...args),
};

export interface SessionUser {
  name?: string;
  email?: string;
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
  /** Admin-settlement; unset treated as unpaid for user messaging */
  payment?: string;
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
  el.innerHTML = `
    <span>${message}</span>
    <button class="close-note" style="margin-left:10px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;">&times;</button>
  `;
  document.body.appendChild(el);
  const remove = (): void => el.remove();
  el.querySelector(".close-note")?.addEventListener("click", remove);
  setTimeout(remove, 4000);
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
  const body = data ?? (await response.json().catch(() => ({})));
  const detail = (body as { detail?: string | { msg?: string }[] }).detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg || "Request failed").join(", ");
  }
  return typeof detail === "string" ? detail : "Request failed";
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
