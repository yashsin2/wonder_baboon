import {
  API_BASE_URL,
  attachSmoothScroll,
  createWbModal,
  getSession,
  isUpcomingTravelDate,
  logger,
  normalizeImageUrl,
  parseError,
  parseTravelDate,
  showMessagePopup,
  showSuccessModal,
  Trip,
  updateHeaderAuth,
} from "./config.js";
import { getItineraryHtmlForTrip, tripHasItineraryForTrip } from "./trip-itineraries.js";
import {
  bookingModalActionsHtml,
  guestBookingFieldsHtml,
  setupBookingPaymentUi,
  submitBookingAndPay,
  validateGuestBookingFields,
  wireBookingMobileField,
} from "./booking-form.js";
import { mountHomePreviousTravels } from "./home-previous-travels.js";
import { fetchRazorpayConfig, PaymentKind } from "./razorpay-checkout.js";
import { TRIP_STYLE_ORDER, TripStyleSlug } from "./trip-styles.js";

interface SwiperInstance {
  destroy: (deleteInstance?: boolean, cleanStyles?: boolean) => void;
  update: () => void;
}

interface SwiperCtor {
  new (selector: string | HTMLElement, options: Record<string, unknown>): SwiperInstance;
}

declare global {
  interface Window {
    Swiper?: SwiperCtor;
  }
}

let tripsSwiper: SwiperInstance | null = null;

const mobileMenuBtn = document.querySelector<HTMLButtonElement>(".mobile-menu-btn");
const navLinks = document.querySelector<HTMLElement>(".nav-links");
const tripsContainer = document.getElementById("tripsContainer");
const searchInput = document.querySelector<HTMLInputElement>("#headerTripSearch");
const searchButton = document.querySelector<HTMLButtonElement>("#headerTripSearchBtn");
const planButton = document.getElementById("planTripBtn");
const heroTravelStyleSelect = document.getElementById("heroTravelStyle") as HTMLSelectElement | null;
const heroTravelMonthSelect = document.getElementById("heroTravelMonth") as HTMLSelectElement | null;
const tripsCountEl = document.getElementById("tripsCount");
const tripsSortSelect = document.getElementById("tripsSort") as HTMLSelectElement | null;

type TripSortKey = "earliest" | "cheapest" | "shortest";
let tripSort: TripSortKey = "earliest";
const heroSelectBackdrop = document.getElementById("heroSelectBackdrop");

const MOBILE_HERO_SELECT = window.matchMedia("(max-width: 768px)");
const enhancedHeroSelects = new Map<HTMLSelectElement, { refresh: () => void }>();

let allTrips: Trip[] = [];

function isUpcomingTrip(trip: Trip): boolean {
  if (!trip.startDate) return true;
  const dateKey = String(trip.startDate).slice(0, 10);
  return isUpcomingTravelDate(dateKey);
}

/** Prefix match — typing "n" matches trips whose title or location starts with "n". */
function tripMatchesPrefix(trip: Trip, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  const title = trip.title.toLowerCase();
  const location = (trip.location || "").toLowerCase();
  return title.startsWith(t) || location.startsWith(t);
}

function getTripSuggestions(term: string, limit = 8): Trip[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  return allTrips.filter((trip) => tripMatchesPrefix(trip, t)).slice(0, limit);
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scrollTripsIntoView(): void {
  document.getElementById("trips")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const TRAVEL_STYLE_SLUGS = new Set<string>(TRIP_STYLE_ORDER);

/** Active vibe filter on home upcoming-trips chips. Empty string means "All vibes". */
let activeStyleChip: TripStyleSlug | "" = "";

function syncStyleChipUi(): void {
  document.querySelectorAll<HTMLElement>("[data-style-chip]").forEach((chip) => {
    const slug = chip.dataset.styleChip || "";
    // The "all" chip is active whenever no specific vibe is selected.
    const isActive = slug === "all" ? activeStyleChip === "" : slug === activeStyleChip;
    chip.classList.toggle("active", isActive);
    chip.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  if (heroTravelStyleSelect) {
    heroTravelStyleSelect.value = activeStyleChip;
    enhancedHeroSelects.get(heroTravelStyleSelect)?.refresh();
  }
}

function refreshHeroSelect(select: HTMLSelectElement | null): void {
  if (!select) return;
  enhancedHeroSelects.get(select)?.refresh();
}

function closeHeroSelectMenus(): void {
  document.querySelectorAll<HTMLElement>(".wb-search-field--select.is-open").forEach((field) => {
    field.classList.remove("is-open");
    field.querySelector<HTMLButtonElement>(".wb-select-btn")?.setAttribute("aria-expanded", "false");
    field.querySelector<HTMLElement>(".wb-select-menu")?.setAttribute("hidden", "");
  });
  heroSelectBackdrop?.setAttribute("hidden", "");
  document.body.classList.remove("wb-select-open");
}

function teardownHeroSelectEnhancement(select: HTMLSelectElement): void {
  const field = select.closest(".wb-search-field--select");
  field?.classList.remove("is-open");
  field?.querySelector(".wb-select-btn")?.remove();
  field?.querySelector(".wb-select-menu")?.remove();
  select.classList.remove("wb-search-select--native");
  enhancedHeroSelects.delete(select);
}

function syncHeroSelectMode(): void {
  closeHeroSelectMenus();
  const selects = [heroTravelStyleSelect, heroTravelMonthSelect].filter(Boolean) as HTMLSelectElement[];

  if (MOBILE_HERO_SELECT.matches) {
    selects.forEach((select) => {
      if (!enhancedHeroSelects.has(select)) enhanceHeroSelect(select);
    });
    return;
  }

  selects.forEach(teardownHeroSelectEnhancement);
  heroSelectBackdrop?.setAttribute("hidden", "");
  document.body.classList.remove("wb-select-open");
}

function enhanceHeroSelect(select: HTMLSelectElement): void {
  const field = select.closest(".wb-search-field--select");
  if (!field || field.querySelector(".wb-select-btn")) return;

  select.classList.add("wb-search-select--native");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wb-select-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");

  const menu = document.createElement("ul");
  menu.className = "wb-select-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  const refresh = (): void => {
    const selected = select.options[select.selectedIndex];
    btn.textContent = selected?.text || select.options[0]?.text || "";
    btn.classList.toggle("is-placeholder", !select.value);

    menu.innerHTML = Array.from(select.options)
      .map((option) => {
        const isSelected = option.value === select.value;
        return `<li role="presentation">
          <button type="button" role="option" class="wb-select-option${isSelected ? " is-selected" : ""}" data-value="${escapeHtml(option.value)}" aria-selected="${isSelected ? "true" : "false"}">
            <span>${escapeHtml(option.text)}</span>
            ${isSelected ? `<span class="wb-select-check" aria-hidden="true">✓</span>` : ""}
          </button>
        </li>`;
      })
      .join("");

    menu.querySelectorAll<HTMLButtonElement>(".wb-select-option").forEach((optionBtn) => {
      optionBtn.addEventListener("click", () => {
        select.value = optionBtn.dataset.value || "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        refresh();
        closeHeroSelectMenus();
      });
    });
  };

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!MOBILE_HERO_SELECT.matches) return;
    if (field.classList.contains("is-open")) {
      closeHeroSelectMenus();
      return;
    }
    closeHeroSelectMenus();
    field.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    heroSelectBackdrop?.removeAttribute("hidden");
    document.body.classList.add("wb-select-open");
  });

  field.appendChild(btn);
  field.appendChild(menu);
  refresh();
  enhancedHeroSelects.set(select, { refresh });
}

function setupHeroMobileSelects(): void {
  syncHeroSelectMode();
  MOBILE_HERO_SELECT.addEventListener("change", syncHeroSelectMode);

  heroSelectBackdrop?.addEventListener("click", closeHeroSelectMenus);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeHeroSelectMenus();
  });
  document.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest(".wb-search-field--select, .wb-select-backdrop")) {
      closeHeroSelectMenus();
    }
  });
}

function tripMatchesMonth(trip: Trip, monthKey: string): boolean {
  if (!monthKey) return true;
  const target = Number(monthKey);
  if (!target || target < 1 || target > 12) return true;

  const startRaw = trip.startDate ? String(trip.startDate).slice(0, 10) : "";
  if (!startRaw) return true;

  const start = parseTravelDate(startRaw);
  const endRaw = trip.endDate ? String(trip.endDate).slice(0, 10) : startRaw;
  const end = parseTravelDate(endRaw);

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= endMonth) {
    if (cursor.getMonth() + 1 === target) return true;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return false;
}

function monthName(monthNum: number): string {
  return new Date(2000, monthNum - 1, 1).toLocaleString("en-US", { month: "long" });
}

function populateHeroMonthOptions(): void {
  if (!heroTravelMonthSelect) return;

  const previous = heroTravelMonthSelect.value;
  heroTravelMonthSelect.innerHTML =
    `<option value="">Choose month</option>` +
    Array.from({ length: 12 }, (_, index) => {
      const monthNum = index + 1;
      return `<option value="${monthNum}">${monthName(monthNum)}</option>`;
    }).join("");

  if (previous && Number(previous) >= 1 && Number(previous) <= 12) {
    heroTravelMonthSelect.value = previous;
  }
  refreshHeroSelect(heroTravelMonthSelect);
}

function setupStyleChipFilters(): void {
  document.querySelectorAll<HTMLElement>("[data-style-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const slug = (chip.dataset.styleChip || "").trim();
      if (slug === "all") {
        activeStyleChip = "";
      } else if (TRAVEL_STYLE_SLUGS.has(slug)) {
        // Tapping the already-active vibe falls back to "All" (empty filter).
        activeStyleChip = activeStyleChip === slug ? "" : (slug as TripStyleSlug);
      } else {
        return;
      }
      syncStyleChipUi();
      filterTripsAndReveal({ scroll: true });
    });
  });
}

function filterTripsCatalog(filters: { destination?: string; travelStyle?: string }): Trip[] {
  let list = [...allTrips];
  const dest = (filters.destination || "").trim().toLowerCase();
  if (dest) {
    list = list.filter((trip) => tripMatchesPrefix(trip, dest));
  }
  const style = (filters.travelStyle || "").trim().toLowerCase();
  if (style && TRAVEL_STYLE_SLUGS.has(style)) {
    list = list.filter((trip) => (trip.tripStyle || "backpackers") === style);
  }
  return list;
}

function setupMobileMenu(): void {
  if (!mobileMenuBtn || !navLinks) return;
  mobileMenuBtn.addEventListener("click", () => {
    navLinks.classList.toggle("active");
    mobileMenuBtn.classList.toggle("active");
  });
}

function openItineraryModal(trip: Trip): void {
  const html = getItineraryHtmlForTrip(trip);
  if (!html) return;
  const safe = escapeHtml(trip.title);
  createWbModal(
    `Itinerary · ${safe}`,
    `<div class="wb-modal-body-scroll itinerary-modal-body">${html}</div>`,
    { wide: true, tall: true }
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function openBookingModal(trip: Trip): void {
  const { token, user } = getSession();
  const isLoggedIn = !!(token && user?.role === "user");
  const defaultDate = trip.startDate || todayIso();
  const minDate = todayIso();
  const guestFields = isLoggedIn ? "" : guestBookingFieldsHtml();

  const body = `
    <p class="muted">${trip.title} · ${trip.location} · ${trip.durationLabel}</p>
    <form id="bk_form" novalidate>
      ${guestFields}
      <label>Date of travel *</label>
      <input id="bk_date" type="date" required value="${defaultDate}" min="${minDate}" />
      <label>Number of people *</label>
      <input id="bk_people" type="number" min="1" max="20" value="1" required />
      <div id="bk_extras_wrap" class="bk-extras-wrap" aria-live="polite"></div>
      <p class="bk-pay-note muted" id="bk_pay_note" hidden></p>
      ${bookingModalActionsHtml()}
    </form>
  `;

  const modal = createWbModal(`Book: ${escapeHtml(trip.title)}`, body);
  if (!isLoggedIn) wireBookingMobileField(modal);

  const extrasWrap = modal.querySelector<HTMLElement>("#bk_extras_wrap");
  const peopleEl = modal.querySelector<HTMLInputElement>("#bk_people");
  const syncBookingExtras = (): void => {
    if (!extrasWrap || !peopleEl) return;
    const n = Number(peopleEl.value);
    const count = Number.isFinite(n) && n >= 1 ? Math.min(20, Math.floor(n)) : 1;
    const needExtras = Math.max(0, count - 1);
    extrasWrap.innerHTML = "";
    if (needExtras === 0) return;
    let html = "";
    for (let i = 0; i < needExtras; i++) {
      const num = i + 2;
      html += `<label>Traveler ${num} full name *</label><input type="text" class="bk-extra-traveler" required minlength="2" autocomplete="name" />`;
    }
    extrasWrap.innerHTML = html;
  };
  syncBookingExtras();
  peopleEl?.addEventListener("input", syncBookingExtras);
  modal.querySelector("#bk_cancel")?.addEventListener("click", () => modal.remove());

  const runPay = (paymentKind: PaymentKind): void => {
    const date = (modal.querySelector("#bk_date") as HTMLInputElement).value;
    const people = Number((modal.querySelector("#bk_people") as HTMLInputElement).value);
    if (!date) {
      showMessagePopup("Please choose a date of travel", "error");
      return;
    }
    if (!Number.isFinite(people) || people < 1) {
      showMessagePopup("Number of people must be at least 1", "error");
      return;
    }
    const needExtras = Math.max(0, Math.min(19, people - 1));
    const extraNames = Array.from(modal.querySelectorAll<HTMLInputElement>(".bk-extra-traveler")).map((el) =>
      el.value.trim(),
    );
    if (extraNames.length !== needExtras) {
      showMessagePopup("Please fill every additional traveler's name.", "error");
      return;
    }
    if (needExtras > 0 && extraNames.some((s) => s.length < 2)) {
      showMessagePopup("Each traveler's name must be at least 2 characters.", "error");
      return;
    }
    if (!isLoggedIn && !validateGuestBookingFields(modal).ok) return;

    const payAdvance = modal.querySelector<HTMLButtonElement>("#bk_pay_advance");
    const payFull = modal.querySelector<HTMLButtonElement>("#bk_pay_full");
    const setBusy = (label: string): void => {
      if (payAdvance) payAdvance.disabled = true;
      if (payFull) payFull.disabled = true;
      if (paymentKind === "full" && payFull) payFull.textContent = label;
      else if (payAdvance) payAdvance.textContent = label;
    };
    const setIdle = (): void => {
      if (!modal.isConnected) return;
      void fetchRazorpayConfig().then((cfg) => {
        if (payAdvance) {
          payAdvance.disabled = !cfg.enabled;
          payAdvance.textContent = `Pay ${cfg.advance_percent}% advance`;
        }
        if (payFull) {
          payFull.disabled = !cfg.enabled;
          payFull.textContent = "Pay full amount";
        }
      });
    };

    void submitBookingAndPay(modal, trip, paymentKind, {
      date,
      people,
      extraNames,
      isLoggedIn,
      token,
      onBusy: setBusy,
      onIdle: setIdle,
    });
  };

  setupBookingPaymentUi(modal, runPay);
}

function setupItineraryButtons(): void {
  if (!tripsContainer) return;
  tripsContainer.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>("[data-itinerary-trip-id]");
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const id = btn.dataset.itineraryTripId || "";
    const trip = allTrips.find((item) => item._id === id);
    if (trip) openItineraryModal(trip);
  });
}

function attachBookHandlers(): void {
  document.querySelectorAll<HTMLElement>("[data-book]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const card = (event.currentTarget as HTMLElement).closest(".trip-card") as HTMLElement | null;
      const tripId = card?.dataset.id;
      const trip = allTrips.find((item) => item._id === tripId);
      if (!trip) {
        logger.warn("Book click but no trip context");
        return;
      }
      openBookingModal(trip);
    });
  });
}

function attachWhatsappHandlers(): void {
  document.querySelectorAll<HTMLAnchorElement>(".btn-book-whatsapp").forEach((link) => {
    link.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const card = link.closest(".trip-card") as HTMLElement | null;
        const trip = allTrips.find((item) => item._id === card?.dataset.id);
        const url = trip ? buildWhatsappBookUrl(trip) : link.href;
        window.open(url, "_blank", "noopener,noreferrer");
      },
      { capture: true }
    );
  });
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function formatTripDateRange(start?: string, end?: string): string {
  if (!start) return "";
  const sd = parseTravelDate(start);
  const monthShort = (d: Date) => d.toLocaleString("en-US", { month: "short" });
  if (!end) return `${ordinal(sd.getDate())} ${monthShort(sd)}`;
  const ed = parseTravelDate(end);
  if (sd.getMonth() === ed.getMonth() && sd.getFullYear() === ed.getFullYear()) {
    return `${ordinal(sd.getDate())} to ${ordinal(ed.getDate())} ${monthShort(sd)}`;
  }
  return `${ordinal(sd.getDate())} ${monthShort(sd)} to ${ordinal(ed.getDate())} ${monthShort(ed)}`;
}

function openTripDetailModal(trip: Trip): void {
  const safeTitle = escapeHtml(trip.title);
  const location = escapeHtml(trip.location);
  const duration = escapeHtml(trip.durationLabel);
  const whenRaw = formatTripDateRange(trip.startDate, trip.endDate);
  const when = escapeHtml(whenRaw || "Dates on request");
  const price = Number(trip.price).toLocaleString("en-IN");
  const img = normalizeImageUrl(trip.imageUrl);

  const body = `
    <div class="trip-detail-modal">
      <div class="trip-detail-media"><img src="${img}" alt="" loading="lazy"></div>
      <p class="muted">${location} · ${duration}</p>
      <p class="trip-detail-when">📅 ${when}</p>
      <p class="trip-detail-price">₹ ${price}</p>
      <div class="wb-modal-actions trip-detail-actions ${tripHasItineraryForTrip(trip) ? "trip-detail-actions--wrap" : ""}">
        ${
          tripHasItineraryForTrip(trip)
            ? '<button type="button" class="btn-itinerary btn-itinerary--modal" id="td_itinerary">📋 Itinerary</button>'
            : ""
        }
        <button type="button" class="wb-cancel" id="td_close">Close</button>
        <button type="button" class="wb-primary" id="td_book">Book this trip</button>
      </div>
    </div>
  `;

  const modal = createWbModal(safeTitle, body);
  modal.querySelector("#td_itinerary")?.addEventListener("click", () => openItineraryModal(trip));
  modal.querySelector("#td_close")?.addEventListener("click", () => modal.remove());
  modal.querySelector("#td_book")?.addEventListener("click", () => {
    modal.remove();
    openBookingModal(trip);
  });
}

/** Compare two ISO date strings; assume start/end are inclusive whole days. */
function daysUntilTripStart(trip: Trip): number {
  if (!trip.startDate) return Number.POSITIVE_INFINITY;
  const start = parseTravelDate(String(trip.startDate).slice(0, 10));
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const ms = start.getTime() - now.getTime();
  return Math.round(ms / 86_400_000);
}

/** Derive trip length (in nights) from start/end dates; falls back to NaN. */
function tripNights(trip: Trip): number {
  if (!trip.startDate || !trip.endDate) return Number.NaN;
  const s = parseTravelDate(String(trip.startDate).slice(0, 10));
  const e = parseTravelDate(String(trip.endDate).slice(0, 10));
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000));
}

/** Returns a small badge object for a trip's urgency, or null when irrelevant.
 *  Pure UI heuristic — no backend field required. */
function getTripUrgency(trip: Trip): { label: string; variant: "hot" | "warm" | "cool" } | null {
  const days = daysUntilTripStart(trip);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days <= 7) return { label: "Closing soon", variant: "hot" };
  if (days <= 14) return { label: "Few seats left", variant: "warm" };
  if (days <= 30) return { label: "Filling up", variant: "cool" };
  return null;
}

/** Builds a pre-filled WhatsApp deep link for a one-tap trip enquiry. */
function buildWhatsappBookUrl(trip: Trip): string {
  const msg = `Hi! i need information about ${trip.title}`;
  return `https://wa.me/919151584677?text=${encodeURIComponent(msg)}`;
}

function renderTripCard(trip: Trip): string {
  const urgency = getTripUrgency(trip);
  const days = daysUntilTripStart(trip);
  const ctaLabel = days <= 7 && days >= 0 ? "Book Today" : "Book Now";
  const waUrl = buildWhatsappBookUrl(trip);
  const safeTitle = escapeHtml(trip.title);
  return `
    <div class="swiper-slide">
      <article class="trip-card" data-id="${trip._id}">
        <div class="trip-card-media">
          <img src="${normalizeImageUrl(trip.imageUrl)}" alt="${safeTitle}" loading="lazy">
          <span class="trip-tag">Trip Special</span>
          <span class="trip-date-badge">${formatTripDateRange(trip.startDate, trip.endDate)}</span>
          ${
            urgency
              ? `<span class="trip-urgency trip-urgency--${urgency.variant}" title="${escapeHtml(urgency.label)}">${escapeHtml(urgency.label)}</span>`
              : ""
          }
        </div>
        <div class="trip-card-body">
          <h3 class="trip-title">${safeTitle}</h3>
          <p class="trip-sub">${escapeHtml(trip.location)}</p>
          <div class="trip-meta">
            <span class="meta-item">📅 ${escapeHtml(trip.durationLabel)}</span>
            <span class="meta-item">📍 ${escapeHtml(trip.location)}</span>
          </div>
          <div class="trip-card-foot">
            <div class="trip-price">₹ ${Number(trip.price).toLocaleString("en-IN")}</div>
            <div class="trip-card-actions">
              ${
                tripHasItineraryForTrip(trip)
                  ? `<button type="button" class="btn-itinerary" data-itinerary-trip-id="${escapeHtml(trip._id)}">📋 Itinerary</button>`
                  : ""
              }
              <a href="#" class="btn-book-now" data-book>${escapeHtml(ctaLabel)}</a>
              <a href="${waUrl}" class="btn-book-whatsapp" target="_blank" rel="noopener noreferrer" aria-label="Book ${safeTitle} on WhatsApp">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.884 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </article>
    </div>`;
}

function initTripsSwiper(): void {
  const SwiperCtor = window.Swiper;
  if (!SwiperCtor) {
    logger.warn("Swiper not available; trips will render statically");
    return;
  }
  if (tripsSwiper) {
    tripsSwiper.destroy(true, true);
    tripsSwiper = null;
  }
  tripsSwiper = new SwiperCtor(".tripsSwiper", {
    slidesPerView: "auto",
    centeredSlides: true,
    grabCursor: true,
    rewind: true,
    speed: 400,
    followFinger: true,
    touchRatio: 1,
    touchAngle: 45,
    threshold: 8,
    longSwipesRatio: 0.25,
    touchEventsTarget: "container",
    preventClicks: false,
    preventClicksPropagation: false,
    autoplay: {
      delay: 5500,
      disableOnInteraction: false,
      pauseOnMouseEnter: true,
    },
    navigation: {
      nextEl: "#tripsNext",
      prevEl: "#tripsPrev",
    },
    pagination: {
      el: ".trips-pagination",
      clickable: true,
    },
  });
}

function sortTripsList(trips: Trip[], key: TripSortKey): Trip[] {
  const list = [...trips];
  switch (key) {
    case "cheapest":
      list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
      break;
    case "shortest":
      list.sort((a, b) => {
        const na = tripNights(a);
        const nb = tripNights(b);
        const safeA = Number.isFinite(na) ? na : Number.POSITIVE_INFINITY;
        const safeB = Number.isFinite(nb) ? nb : Number.POSITIVE_INFINITY;
        return safeA - safeB;
      });
      break;
    case "earliest":
    default:
      list.sort((a, b) => daysUntilTripStart(a) - daysUntilTripStart(b));
      break;
  }
  return list;
}

function updateTripsCount(count: number): void {
  if (!tripsCountEl) return;
  if (count <= 0) {
    tripsCountEl.textContent = "No trips match";
    return;
  }
  const noun = count === 1 ? "trip" : "trips";
  tripsCountEl.textContent = `${count} ${noun} available`;
}

function renderTrips(trips: Trip[], options?: { emptyHint?: string }): void {
  if (!tripsContainer) return;
  const sorted = trips.length ? sortTripsList(trips, tripSort) : trips;
  updateTripsCount(sorted.length);
  const emptyHint = options?.emptyHint ?? "No trips available right now.";
  if (!sorted.length) {
    tripsContainer.innerHTML = `<div class="swiper-slide"><div class="trip-empty">${emptyHint}</div></div>`;
  } else {
    tripsContainer.innerHTML = sorted.map(renderTripCard).join("");
  }
  attachBookHandlers();
  attachWhatsappHandlers();
  initTripsSwiper();
}

function setupTripSort(): void {
  if (!tripsSortSelect) return;
  tripsSortSelect.value = tripSort;
  tripsSortSelect.addEventListener("change", () => {
    const value = tripsSortSelect.value as TripSortKey;
    if (value === "earliest" || value === "cheapest" || value === "shortest") {
      tripSort = value;
      filterTripsAndReveal();
    }
  });
}

function populateNavTripsDropdown(): void {
  const menu = document.getElementById("navTripsMenu");
  if (!menu || !allTrips.length) {
    if (menu) menu.innerHTML = '<div class="nav-dropdown-empty">No trips right now</div>';
    return;
  }

  const grouped = new Map<string, Trip[]>();
  for (const trip of allTrips) {
    const state = trip.location || "Other";
    if (!grouped.has(state)) grouped.set(state, []);
    grouped.get(state)!.push(trip);
  }

  const sortedStates = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

  let html = "";
  for (const state of sortedStates) {
    const trips = grouped.get(state)!;
    html += `<div class="nav-dropdown-group">`;
    html += `<div class="nav-dropdown-state">${escapeHtml(state)}</div>`;
    for (const trip of trips) {
      const dateRange = formatTripDateRange(trip.startDate, trip.endDate);
      const price = `₹${Number(trip.price).toLocaleString("en-IN")}`;
      html += `<button type="button" class="nav-dropdown-trip" data-trip-id="${escapeHtml(trip._id)}" role="menuitem">
        <span class="nav-dropdown-trip-name">${escapeHtml(trip.title)}</span>
        <span class="nav-dropdown-trip-meta">${dateRange ? escapeHtml(dateRange) + " · " : ""}${price}</span>
      </button>`;
    }
    html += `</div>`;
  }

  html += `<div class="nav-dropdown-footer"><a href="#trips" class="nav-dropdown-all">View all upcoming trips →</a></div>`;

  menu.innerHTML = html;
  attachSmoothScroll(menu);

  menu.querySelector(".nav-dropdown-all")?.addEventListener("click", () => {
    closeNavDropdown();
  });

  menu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".nav-dropdown-trip");
    if (!btn) return;
    const trip = allTrips.find((t) => t._id === btn.dataset.tripId);
    if (trip) {
      closeNavDropdown();
      openTripDetailModal(trip);
    }
  });
}

function setupNavTripsDropdown(): void {
  const wrapper = document.getElementById("navTripsDropdown");
  const trigger = wrapper?.querySelector<HTMLAnchorElement>(".nav-dropdown-trigger");
  const menu = document.getElementById("navTripsMenu");
  if (!wrapper || !trigger || !menu) return;

  let open = false;

  function openDropdown() {
    if (open) return;
    open = true;
    wrapper!.classList.add("nav-dropdown--open");
    trigger!.setAttribute("aria-expanded", "true");
  }

  function closeDropdown() {
    if (!open) return;
    open = false;
    wrapper!.classList.remove("nav-dropdown--open");
    trigger!.setAttribute("aria-expanded", "false");
  }

  // Desktop: hover
  wrapper.addEventListener("mouseenter", openDropdown);
  wrapper.addEventListener("mouseleave", closeDropdown);

  // Never scroll on click — hover opens on desktop, tap toggles on mobile
  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.innerWidth <= 768) {
      open ? closeDropdown() : openDropdown();
    }
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (open && !wrapper.contains(e.target as Node)) closeDropdown();
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) closeDropdown();
  });
}

function closeNavDropdown(): void {
  const wrapper = document.getElementById("navTripsDropdown");
  wrapper?.classList.remove("nav-dropdown--open");
  wrapper?.querySelector(".nav-dropdown-trigger")?.setAttribute("aria-expanded", "false");
}

async function loadTrips(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/trips`);
    const text = await response.text();
    let payload: { trips?: Trip[] } = {};
    if (text) {
      try {
        payload = JSON.parse(text) as { trips?: Trip[] };
      } catch {
        throw new Error(
          "Could not load trips — the server sent an invalid response. Try Ctrl+Shift+R (hard refresh) or clear cached files for this site."
        );
      }
    }
    if (!response.ok) throw new Error(await parseError(response, payload));
    allTrips = (payload.trips || []).filter(isUpcomingTrip);
    syncStyleChipUi();
    filterTripsAndReveal();
    populateNavTripsDropdown();
  } catch (error) {
    const msg =
      error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("Load failed"))
        ? "Can't reach the trip server. Check your connection or try again."
        : error instanceof Error
          ? error.message
          : "Trips could not be loaded.";
    showMessagePopup(msg, "error");
  }
}

function filterUpcomingTrips(term: string, applyStyleWhenEmpty = true): Trip[] {
  const t = term.trim().toLowerCase();
  let filtered = !t ? [...allTrips] : allTrips.filter((trip) => tripMatchesPrefix(trip, t));
  if (applyStyleWhenEmpty && !t && activeStyleChip) {
    filtered = filtered.filter((trip) => (trip.tripStyle || "backpackers") === activeStyleChip);
  }
  return filtered;
}

function clearHeroSearchInputs(): void {
  if (heroTravelStyleSelect) heroTravelStyleSelect.value = "";
  if (heroTravelMonthSelect) heroTravelMonthSelect.value = "";
  refreshHeroSelect(heroTravelStyleSelect);
  refreshHeroSelect(heroTravelMonthSelect);
}

function clearSearchInputs(): void {
  if (searchInput) searchInput.value = "";
  document.querySelectorAll<HTMLElement>(".search-dropdown").forEach((dropdown) => {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
  });
}

function syncStyleChipFromTrips(trips: Trip[]): void {
  if (trips.length === 1) {
    activeStyleChip = (trips[0].tripStyle || "backpackers") as TripStyleSlug;
  } else if (trips.length !== 1) {
    activeStyleChip = "";
  }
  syncStyleChipUi();
}

function applyTripSearch(term: string, opts?: { scroll?: boolean; commit?: boolean }): void {
  const t = term.trim();
  const filtered = filterUpcomingTrips(t, !t);
  const emptyHint =
    filtered.length === 0
      ? t
        ? "No upcoming trips match this search. Try another name."
        : activeStyleChip
          ? "No upcoming trips for this vibe right now."
          : undefined
      : undefined;
  renderTrips(filtered, emptyHint ? { emptyHint } : undefined);
  if (t && filtered.length > 0) syncStyleChipFromTrips(filtered);
  if (opts?.commit) clearSearchInputs();
  if (opts?.scroll) scrollTripsIntoView();
}

function filterTripsAndReveal(opts?: { scroll?: boolean; commit?: boolean }): void {
  applyTripSearch(searchInput?.value || "", opts);
}

function selectTripFromSearch(trip: Trip): void {
  activeStyleChip = (trip.tripStyle || "backpackers") as TripStyleSlug;
  syncStyleChipUi();
  renderTrips([trip]);
  clearSearchInputs();
  scrollTripsIntoView();
}

function highlightPrefix(text: string, term: string): string {
  const t = term.trim();
  if (!t) return escapeHtml(text);
  if (!text.toLowerCase().startsWith(t.toLowerCase())) return escapeHtml(text);
  return `<mark class="suggestion-mark">${escapeHtml(text.slice(0, t.length))}</mark>${escapeHtml(text.slice(t.length))}`;
}

function suggestionMeta(trip: Trip): string {
  const parts = [trip.location, trip.durationLabel].filter(Boolean);
  return parts.join(" · ");
}

function ensureSuggestionDropdown(input: HTMLInputElement): HTMLElement {
  const host = input.closest(".search-bar, .search-box");
  if (!host) throw new Error("Search input must sit inside .search-bar or .search-box");
  let dropdown = host.querySelector<HTMLElement>(".search-dropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.className = "search-dropdown";
    dropdown.setAttribute("role", "listbox");
    host.appendChild(dropdown);
  }
  return dropdown;
}

function hideSuggestionDropdown(dropdown: HTMLElement): void {
  dropdown.style.display = "none";
  dropdown.innerHTML = "";
}

function renderSearchSuggestions(input: HTMLInputElement, dropdown: HTMLElement): void {
  const term = input.value.trim();
  const matches = getTripSuggestions(term);
  if (!term) {
    hideSuggestionDropdown(dropdown);
    return;
  }
  if (matches.length === 0) {
    dropdown.innerHTML = `<p class="search-dropdown-empty">No upcoming trips starting with “${escapeHtml(term)}”</p>`;
    dropdown.style.display = "block";
    return;
  }
  dropdown.innerHTML = `
    <p class="search-dropdown-header">Upcoming trips</p>
    ${matches
      .map(
        (trip) => `
    <button type="button" class="suggestion-item" role="option" data-trip-id="${escapeHtml(trip._id)}">
      <img class="suggestion-thumb" src="${escapeHtml(normalizeImageUrl(trip.imageUrl))}" alt="" loading="lazy" decoding="async" />
      <span class="suggestion-item-body">
        <strong>${highlightPrefix(trip.title, term)}</strong>
        ${suggestionMeta(trip) ? `<span class="suggestion-meta">${escapeHtml(suggestionMeta(trip))}</span>` : ""}
      </span>
      <span class="suggestion-price-col">
        <span class="suggestion-from">from</span>
        <span class="suggestion-item-price">₹${Number(trip.price).toLocaleString("en-IN")}</span>
      </span>
    </button>`,
      )
      .join("")}`;
  dropdown.style.display = "block";
  dropdown.querySelectorAll<HTMLButtonElement>(".suggestion-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const trip = allTrips.find((item) => item._id === btn.dataset.tripId);
      if (!trip) return;
      hideSuggestionDropdown(dropdown);
      selectTripFromSearch(trip);
    });
  });
}

function setupSearchSuggestions(input: HTMLInputElement): void {
  const dropdown = ensureSuggestionDropdown(input);
  const refresh = (): void => renderSearchSuggestions(input, dropdown);

  input.addEventListener("input", () => {
    refresh();
    if (input === searchInput) applyTripSearch(input.value, { scroll: false });
  });
  input.addEventListener("focus", refresh);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideSuggestionDropdown(dropdown);
  });
  document.addEventListener("click", (e) => {
    if (!input.closest(".search-bar, .search-box")?.contains(e.target as Node)) {
      hideSuggestionDropdown(dropdown);
    }
  });
}

function handleHeroFindTrips(): void {
  const style = heroTravelStyleSelect?.value.trim() || "";
  const month = heroTravelMonthSelect?.value.trim() || "";

  if (!style && !month) {
    showMessagePopup("Choose a travel style or month to search.", "error");
    return;
  }

  if (style && TRAVEL_STYLE_SLUGS.has(style)) {
    activeStyleChip = style as TripStyleSlug;
    syncStyleChipUi();
  }

  let filtered = [...allTrips];
  if (style && TRAVEL_STYLE_SLUGS.has(style)) {
    filtered = filtered.filter((trip) => (trip.tripStyle || "backpackers") === style);
  }
  if (month) {
    filtered = filtered.filter((trip) => tripMatchesMonth(trip, month));
  }

  const emptyHint =
    filtered.length === 0
      ? "No upcoming trips match those filters. Try another style or month."
      : undefined;
  renderTrips(filtered, emptyHint ? { emptyHint } : undefined);
  clearHeroSearchInputs();
  scrollTripsIntoView();
}

/**
 * Pause hero Ken Burns slideshow when scrolled off-screen — keeps GPU free
 * while the user scrolls the rest of the page.
 */
function setupHeroAnimationPause(): void {
  const hero = document.querySelector<HTMLElement>(".hero-cinematic");
  if (!hero) return;

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    hero.classList.add("is-offscreen");
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      hero.classList.toggle("is-offscreen", !entry?.isIntersecting);
    },
    { root: null, threshold: 0, rootMargin: "0px" },
  );
  observer.observe(hero);
}

function setupTripCardOpenDetail(): void {
  if (!tripsContainer) return;
  tripsContainer.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (
      target.closest("[data-book]") ||
      target.closest("[data-itinerary-trip-id]") ||
      target.closest(".btn-book-whatsapp")
    ) {
      return;
    }
    const card = target.closest(".trip-card") as HTMLElement | null;
    if (!card?.dataset.id) return;
    const trip = allTrips.find((item) => item._id === card.dataset.id);
    if (!trip) return;
    event.preventDefault();
    event.stopPropagation();
    openTripDetailModal(trip);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.body.style.overflow = "";
  document.body.classList.remove("wb-razorpay-checkout");
  updateHeaderAuth();
  await mountHomePreviousTravels();
  setupMobileMenu();
  attachSmoothScroll(document);
  setupHeroAnimationPause();
  setupStyleChipFilters();
  setupTripSort();
  setupNavTripsDropdown();
  populateHeroMonthOptions();
  setupHeroMobileSelects();
  syncStyleChipUi();
  setupTripCardOpenDetail();
  setupItineraryButtons();
  await loadTrips();
  if (searchInput) {
    setupSearchSuggestions(searchInput);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        filterTripsAndReveal({ scroll: true, commit: true });
      }
    });
  }
  if (searchButton) {
    searchButton.addEventListener("click", () => filterTripsAndReveal({ scroll: true, commit: true }));
  }
  if (planButton) planButton.addEventListener("click", handleHeroFindTrips);
  heroTravelStyleSelect?.addEventListener("change", () => {
    const style = heroTravelStyleSelect.value.trim();
    if (style && TRAVEL_STYLE_SLUGS.has(style)) {
      activeStyleChip = style as TripStyleSlug;
      syncStyleChipUi();
    }
  });
});
