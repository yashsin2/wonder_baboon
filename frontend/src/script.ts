import {
  API_BASE_URL,
  attachSmoothScroll,
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
  BookingSavedPayload,
  bookingAdvanceNoticeText,
  completeBookingWithOptionalRazorpay,
  fetchRazorpayConfig,
  handlePaymentFlowError,
} from "./razorpay-checkout.js";
import { mountHomePreviousTravels } from "./home-previous-travels.js";
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

/** Active vibe filter on home upcoming-trips chips (panel links still go to style pages). */
let activeStyleChip: TripStyleSlug | "" = "backpackers";

function syncStyleChipUi(): void {
  document.querySelectorAll<HTMLElement>("[data-style-chip]").forEach((chip) => {
    const isActive = chip.dataset.styleChip === activeStyleChip;
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
      if (!slug || !TRAVEL_STYLE_SLUGS.has(slug)) return;
      activeStyleChip = activeStyleChip === slug ? "" : (slug as TripStyleSlug);
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

function createWbModal(
  title: string,
  bodyHtml: string,
  options?: { wide?: boolean; tall?: boolean }
): HTMLDivElement {
  const modal = document.createElement("div");
  modal.className = "wb-modal";
  const cardClass = [
    "wb-modal-card",
    options?.wide ? "wb-modal-card--wide" : "",
    options?.tall ? "wb-modal-card--tall" : "",
  ]
    .filter(Boolean)
    .join(" ");
  modal.innerHTML = `
    <div class="${cardClass}">
      <div class="wb-modal-head">
        <h3>${title}</h3>
        <button type="button" class="wb-modal-close" aria-label="Close">&times;</button>
      </div>
      ${bodyHtml}
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector(".wb-modal-close")?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
  return modal;
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

  const guestFields = isLoggedIn
    ? ""
    : `
      <label>Full name *</label>
      <input id="bk_name" type="text" required minlength="2" />
      <label>Mobile *</label>
      <input id="bk_mobile" type="tel" required placeholder="10-digit Indian number" />
      <label>Email</label>
      <input id="bk_email" type="email" />
    `;

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
      <div class="wb-modal-actions">
        <button type="button" class="wb-cancel" id="bk_cancel">Cancel</button>
        <button type="submit" class="wb-primary" id="bk_submit">Confirm booking</button>
      </div>
    </form>
  `;

  const modal = createWbModal(`Book: ${escapeHtml(trip.title)}`, body);
  let paySubmitLabel = "Confirm booking";

  void fetchRazorpayConfig().then((cfg) => {
    if (!cfg.enabled) return;
    const note = modal.querySelector<HTMLElement>("#bk_pay_note");
    const submit = modal.querySelector<HTMLButtonElement>("#bk_submit");
    if (note) {
      note.hidden = false;
      note.textContent = bookingAdvanceNoticeText(cfg.advance_percent, cfg.advance_refund_days ?? 12);
    }
    if (submit) {
      paySubmitLabel = `Book & pay ${cfg.advance_percent}% advance`;
      submit.textContent = paySubmitLabel;
    }
  });

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

  modal.querySelector<HTMLFormElement>("#bk_form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
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
      el.value.trim()
    );
    if (extraNames.length !== needExtras) {
      showMessagePopup("Please fill every additional traveler's name.", "error");
      return;
    }
    if (needExtras > 0 && extraNames.some((s) => s.length < 2)) {
      showMessagePopup("Each traveler's name must be at least 2 characters.", "error");
      return;
    }

    const submitBtn = modal.querySelector<HTMLButtonElement>("#bk_submit");
    const resetSubmitBtn = (): void => {
      if (!submitBtn?.isConnected) return;
      submitBtn.disabled = false;
      submitBtn.textContent = paySubmitLabel;
    };
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Booking…";
    }

    try {
      let saved: BookingSavedPayload = {};
      let contact: { name?: string; email?: string; mobile?: string } = {};
      if (isLoggedIn) {
        const res = await fetch(`${API_BASE_URL}/bookings/user`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            trip_id: trip._id,
            date_of_travel: date,
            number_of_people: people,
            additional_travelers: extraNames,
          }),
        });
        if (!res.ok) throw new Error(await parseError(res));
        saved = await res.json();
        contact = {
          name: user?.name,
          email: user?.email,
          mobile: user?.mobile,
        };
      } else {
        const name = (modal.querySelector("#bk_name") as HTMLInputElement).value.trim();
        const mobile = (modal.querySelector("#bk_mobile") as HTMLInputElement).value.trim();
        const email = (modal.querySelector("#bk_email") as HTMLInputElement).value.trim();
        if (!name || !mobile) {
          showMessagePopup("Name and mobile are required", "error");
          resetSubmitBtn();
          return;
        }
        const res = await fetch(`${API_BASE_URL}/bookings/guest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trip_id: trip._id,
            travel_destination: trip.title,
            date_of_travel: date,
            full_name: name,
            mobile,
            email: email || null,
            number_of_people: people,
            additional_travelers: extraNames,
          }),
        });
        if (!res.ok) throw new Error(await parseError(res));
        saved = await res.json();
        contact = { name, email: email || undefined, mobile };
      }
      const refundDays = saved.advance_refund_days ?? 12;
      if (saved.razorpay_enabled) {
        if (submitBtn) submitBtn.textContent = "Opening payment…";
        try {
          const { message } = await completeBookingWithOptionalRazorpay(saved, contact, trip.title, date);
          modal.remove();
          showSuccessModal("Booking confirmed", message);
        } catch (payError) {
          modal.remove();
          const bookingId = (saved.booking_id || "").trim();
          handlePaymentFlowError(
            payError,
            refundDays,
            bookingId
              ? {
                  bookingId,
                  contact,
                  tripTitle: trip.title,
                  travelDate: date,
                }
              : undefined
          );
          logger.warn("advance payment not completed", payError);
        }
      } else {
        modal.remove();
        showSuccessModal(
          "Booking received",
          `Your booking for ${trip.title} on ${date} is in. Our team will reach out shortly.`
        );
      }
      logger.info("booking confirmed", { trip: trip.title, date, people });
    } catch (error) {
      logger.error("booking failed", error);
      showMessagePopup(error instanceof Error ? error.message : "Booking failed", "error");
    } finally {
      resetSubmitBtn();
    }
  });
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

function renderTripCard(trip: Trip): string {
  return `
    <div class="swiper-slide">
      <article class="trip-card" data-id="${trip._id}">
        <div class="trip-card-media">
          <img src="${normalizeImageUrl(trip.imageUrl)}" alt="${trip.title}" loading="lazy">
          <span class="trip-tag">Trip Special</span>
          <span class="trip-date-badge">${formatTripDateRange(trip.startDate, trip.endDate)}</span>
        </div>
        <div class="trip-card-body">
          <h3 class="trip-title">${trip.title}</h3>
          <p class="trip-sub">${trip.location}</p>
          <div class="trip-meta">
            <span class="meta-item">📅 ${trip.durationLabel}</span>
            <span class="meta-item">📍 ${trip.location}</span>
          </div>
          <div class="trip-card-foot">
            <div class="trip-price">₹ ${Number(trip.price).toLocaleString("en-IN")}</div>
            <div class="trip-card-actions">
              ${
                tripHasItineraryForTrip(trip)
                  ? `<button type="button" class="btn-itinerary" data-itinerary-trip-id="${escapeHtml(trip._id)}">📋 Itinerary</button>`
                  : ""
              }
              <a href="#" class="btn-book-now" data-book>📞 Book Now</a>
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
    slidesPerView: 1,
    spaceBetween: 16,
    watchOverflow: true,
    navigation: {
      nextEl: "#tripsNext",
      prevEl: "#tripsPrev",
    },
    pagination: {
      el: ".trips-pagination",
      clickable: true,
    },
    breakpoints: {
      560: { slidesPerView: 2, spaceBetween: 16 },
      900: { slidesPerView: 3, spaceBetween: 20 },
      1200: { slidesPerView: 4, spaceBetween: 24 },
    },
  });
}

function renderTrips(trips: Trip[], options?: { emptyHint?: string }): void {
  if (!tripsContainer) return;
  const emptyHint = options?.emptyHint ?? "No trips available right now.";
  if (!trips.length) {
    tripsContainer.innerHTML = `<div class="swiper-slide"><div class="trip-empty">${emptyHint}</div></div>`;
  } else {
    tripsContainer.innerHTML = trips.map(renderTripCard).join("");
  }
  attachBookHandlers();
  initTripsSwiper();
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
 * JS-driven parallax for sections that opt in via `[data-parallax]`
 * (currently `.trips` and `.about-us`).
 *
 * Why JS instead of `background-attachment: fixed`?
 * `fixed` ties the photo to the VIEWPORT, which causes the photo's edges
 * to briefly align with the section's edges as you scroll, producing a
 * thin tone-mismatched "line" at the boundary with adjacent sections.
 * This implementation welds the photo to the section (via a ::before
 * pseudo-element that is taller than the section) and shifts its internal
 * position with a translateY proportional to the section's distance from
 * the viewport centre. The photo always FITS the frame and still MOVES.
 */
function setupParallax(): void {
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    logger.info("Parallax disabled: user prefers reduced motion");
    return;
  }

  const sections = Array.from(
    document.querySelectorAll<HTMLElement>(".trips, .about-us"),
  );
  if (sections.length === 0) return;

  // Strength tuned so the photo lags subtly behind content (~22%).
  // The ::before pseudo is sized to allow up to 25% translation in either
  // direction, so this stays within bounds for any reasonable viewport.
  const PARALLAX_STRENGTH = 0.22;

  let frameRequested = false;

  const update = (): void => {
    frameRequested = false;
    const viewportH = window.innerHeight;
    const viewportCenter = viewportH / 2;
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      // Only run math while the section is anywhere near the viewport.
      if (rect.bottom < -viewportH || rect.top > viewportH * 2) {
        section.style.setProperty("--parallax-y", "0px");
        continue;
      }
      const sectionCenter = rect.top + rect.height / 2;
      const distance = sectionCenter - viewportCenter;
      const offset = -distance * PARALLAX_STRENGTH;
      section.style.setProperty("--parallax-y", `${offset.toFixed(2)}px`);
    }
  };

  const requestUpdate = (): void => {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(update);
  };

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate, { passive: true });
  update();
  logger.info("Parallax initialised", { sections: sections.length });
}

function setupTripCardOpenDetail(): void {
  if (!tripsContainer) return;
  tripsContainer.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-book]") || target.closest("[data-itinerary-trip-id]")) return;
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
  updateHeaderAuth();
  await mountHomePreviousTravels();
  setupMobileMenu();
  attachSmoothScroll(document);
  setupParallax();
  setupStyleChipFilters();
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
