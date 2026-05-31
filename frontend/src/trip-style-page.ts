import {
  API_BASE_URL,
  getSession,
  logger,
  normalizeImageUrl,
  parseError,
  parseTravelDate,
  showMessagePopup,
  showSuccessModal,
  Trip,
  TripStyleSlug,
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
import {
  normalizeTripStyle,
  renderStyleIntroHtml,
  TRIP_STYLE_ORDER,
  TRIP_STYLES,
  tripStyleSlugFromPath,
} from "./trip-styles.js";

const styleSlug =
  (document.body.dataset.tripStyle as TripStyleSlug | undefined) ||
  tripStyleSlugFromPath(window.location.pathname) ||
  "backpackers";

const styleConfig = TRIP_STYLES[normalizeTripStyle(styleSlug)];
let styleTrips: Trip[] = [];

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function createWbModal(title: string, bodyHtml: string, options?: { wide?: boolean; tall?: boolean }): HTMLDivElement {
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
    </div>`;
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
  createWbModal(
    `Itinerary · ${escapeHtml(trip.title)}`,
    `<div class="wb-modal-body-scroll itinerary-modal-body">${html}</div>`,
    { wide: true, tall: true },
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
      <input id="bk_email" type="email" />`;

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
    </form>`;

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
      html += `<label>Traveler ${i + 2} full name *</label><input type="text" class="bk-extra-traveler" required minlength="2" autocomplete="name" />`;
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
    const needExtras = Math.max(0, Math.min(19, people - 1));
    const extraNames = Array.from(modal.querySelectorAll<HTMLInputElement>(".bk-extra-traveler")).map((el) =>
      el.value.trim(),
    );
    if (extraNames.length !== needExtras || (needExtras > 0 && extraNames.some((s) => s.length < 2))) {
      showMessagePopup("Please fill every additional traveler's name.", "error");
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
        contact = { name: user?.name, email: user?.email, mobile: user?.mobile };
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
          handlePaymentFlowError(payError, refundDays);
          logger.warn("advance payment not completed", payError);
        }
      } else {
        modal.remove();
        showSuccessModal(
          "Booking received",
          `Your booking for ${trip.title} on ${date} is in. Our team will reach out shortly.`
        );
      }
    } catch (error) {
      showMessagePopup(error instanceof Error ? error.message : "Booking failed", "error");
    } finally {
      resetSubmitBtn();
    }
  });
}

function renderTripCard(trip: Trip): string {
  return `
    <article class="trip-card style-page-trip-card" data-id="${trip._id}">
      <div class="trip-card-media">
        <img src="${normalizeImageUrl(trip.imageUrl)}" alt="${escapeHtml(trip.title)}" loading="lazy">
        <span class="trip-tag">${escapeHtml(styleConfig.shortLabel)}</span>
        <span class="trip-date-badge">${formatTripDateRange(trip.startDate, trip.endDate)}</span>
      </div>
      <div class="trip-card-body">
        <h3 class="trip-title">${escapeHtml(trip.title)}</h3>
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
            <a href="#" class="btn-book-now" data-book>📞 Book Now</a>
          </div>
        </div>
      </div>
    </article>`;
}

function attachTripInteractions(): void {
  const grid = document.getElementById("styleTripsGrid");
  if (!grid) return;

  grid.querySelectorAll<HTMLElement>("[data-book]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const card = (event.currentTarget as HTMLElement).closest(".trip-card") as HTMLElement | null;
      const trip = styleTrips.find((t) => t._id === card?.dataset.id);
      if (trip) openBookingModal(trip);
    });
  });

  grid.querySelectorAll<HTMLElement>("[data-itinerary-trip-id]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = btn.dataset.itineraryTripId || "";
      const trip = styleTrips.find((t) => t._id === id);
      if (trip) openItineraryModal(trip);
    });
  });

  grid.querySelectorAll<HTMLElement>(".trip-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-book]") || target.closest("[data-itinerary-trip-id]")) return;
      const trip = styleTrips.find((t) => t._id === card.dataset.id);
      if (trip) {
        event.preventDefault();
        event.stopPropagation();
        openTripDetailModal(trip);
      }
    });
  });
}

/** Every vibe collection page uses the same cinematic hero layout as Motorcycle Diaries. */
const CINEMATIC_HERO_STYLES: TripStyleSlug[] = [...TRIP_STYLE_ORDER];

function renderCinematicHeroHtml(style: typeof styleConfig): string {
  const modifier = style.slug.replace(/_/g, "-");
  return `
    <div class="cinematic-hero cinematic-hero--${modifier}">
      <div class="cinematic-hero__banner">
        <p class="trip-style-page-kicker">Wonder Baboon presents</p>
        <div class="cinematic-hero__titles">
          <h1 class="trip-style-page-title" id="tripStylePageTitle">${escapeHtml(style.title)}</h1>
          <p class="trip-style-page-tagline">${escapeHtml(style.tagline)}</p>
        </div>
      </div>
      <div class="cinematic-hero__copy trip-style-page-intro">
        ${renderStyleIntroHtml(style)}
      </div>
    </div>`;
}

function renderIntro(): void {
  const hero = document.getElementById("tripStylePageHero");
  if (!hero) return;
  hero.className = `trip-style-page-hero ${styleConfig.cssClass}`;

  if (CINEMATIC_HERO_STYLES.includes(styleConfig.slug)) {
    hero.innerHTML = renderCinematicHeroHtml(styleConfig);
  } else {
    hero.innerHTML = `
    <p class="trip-style-page-kicker">Wonder Baboon presents</p>
    <h1 class="trip-style-page-title" id="tripStylePageTitle">${escapeHtml(styleConfig.title)}</h1>
    <p class="trip-style-page-tagline">${escapeHtml(styleConfig.tagline)}</p>
    <div class="trip-style-page-intro">${renderStyleIntroHtml(styleConfig)}</div>`;
  }

  document.title = `${styleConfig.title} · Wonder Baboon`;
  const headerTitle = document.getElementById("stylePageHeaderTitle");
  if (headerTitle) headerTitle.textContent = styleConfig.shortLabel;
}

function renderTripsGrid(trips: Trip[]): void {
  const grid = document.getElementById("styleTripsGrid");
  const countEl = document.getElementById("styleTripsCount");
  if (!grid) return;
  if (countEl) {
    countEl.textContent =
      trips.length === 0
        ? "No trips in this collection yet"
        : `${trips.length} trip${trips.length === 1 ? "" : "s"} in this collection`;
  }
  if (!trips.length) {
    grid.innerHTML = `<div class="style-trips-empty"><p>No ${escapeHtml(styleConfig.shortLabel)} trips published yet. Check back soon or explore another vibe from the menu.</p><a href="/" class="style-trips-home-link">← Back to home</a></div>`;
    return;
  }
  grid.innerHTML = trips.map(renderTripCard).join("");
  attachTripInteractions();
}

async function loadStyleTrips(): Promise<void> {
  const grid = document.getElementById("styleTripsGrid");
  if (grid) grid.innerHTML = '<p class="style-trips-loading">Loading trips…</p>';
  try {
    const response = await fetch(`${API_BASE_URL}/trips`);
    const payload = (await response.json()) as { trips?: Trip[] };
    if (!response.ok) throw new Error(await parseError(response, payload));
    styleTrips = (payload.trips || []).filter(
      (trip) => normalizeTripStyle(trip.tripStyle) === normalizeTripStyle(styleSlug),
    );
    renderTripsGrid(styleTrips);
  } catch (error) {
    if (grid) {
      grid.innerHTML = `<div class="style-trips-empty"><p>${escapeHtml(error instanceof Error ? error.message : "Could not load trips")}</p></div>`;
    }
    logger.error("style page trips load failed", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateHeaderAuth();
  renderIntro();
  void loadStyleTrips();
});
