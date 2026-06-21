import { API_BASE_URL, createWbModal, getSession, logger, normalizeImageUrl, parseError, parseTravelDate, showMessagePopup, updateHeaderAuth, } from "./config.js";
import { getItineraryHtmlForTrip, tripHasItineraryForTrip } from "./trip-itineraries.js";
import { bookingModalActionsHtml, guestBookingFieldsHtml, setupBookingPaymentUi, submitBookingAndPay, validateGuestBookingFields, wireBookingMobileField, } from "./booking-form.js";
import { fetchRazorpayConfig } from "./razorpay-checkout.js";
import { normalizeTripStyle, renderStyleIntroHtml, TRIP_STYLE_ORDER, TRIP_STYLES, tripStyleSlugFromPath, } from "./trip-styles.js";
const styleSlug = document.body.dataset.tripStyle ||
    tripStyleSlugFromPath(window.location.pathname) ||
    "backpackers";
const styleConfig = TRIP_STYLES[normalizeTripStyle(styleSlug)];
let styleTrips = [];
function escapeHtml(raw) {
    return raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
function formatTripDateRange(start, end) {
    if (!start)
        return "";
    const sd = parseTravelDate(start);
    const monthShort = (d) => d.toLocaleString("en-US", { month: "short" });
    if (!end)
        return `${ordinal(sd.getDate())} ${monthShort(sd)}`;
    const ed = parseTravelDate(end);
    if (sd.getMonth() === ed.getMonth() && sd.getFullYear() === ed.getFullYear()) {
        return `${ordinal(sd.getDate())} to ${ordinal(ed.getDate())} ${monthShort(sd)}`;
    }
    return `${ordinal(sd.getDate())} ${monthShort(sd)} to ${ordinal(ed.getDate())} ${monthShort(ed)}`;
}
function openItineraryModal(trip) {
    const html = getItineraryHtmlForTrip(trip);
    if (!html)
        return;
    createWbModal(`Itinerary · ${escapeHtml(trip.title)}`, `<div class="wb-modal-body-scroll itinerary-modal-body">${html}</div>`, { wide: true, tall: true });
}
function todayIso() {
    return new Date().toISOString().slice(0, 10);
}
function openTripDetailModal(trip) {
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
        ${tripHasItineraryForTrip(trip)
        ? '<button type="button" class="btn-itinerary btn-itinerary--modal" id="td_itinerary">📋 Itinerary</button>'
        : ""}
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
function openBookingModal(trip) {
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
    </form>`;
    const modal = createWbModal(`Book: ${escapeHtml(trip.title)}`, body);
    if (!isLoggedIn)
        wireBookingMobileField(modal);
    const extrasWrap = modal.querySelector("#bk_extras_wrap");
    const peopleEl = modal.querySelector("#bk_people");
    const syncBookingExtras = () => {
        if (!extrasWrap || !peopleEl)
            return;
        const n = Number(peopleEl.value);
        const count = Number.isFinite(n) && n >= 1 ? Math.min(20, Math.floor(n)) : 1;
        const needExtras = Math.max(0, count - 1);
        extrasWrap.innerHTML = "";
        if (needExtras === 0)
            return;
        let html = "";
        for (let i = 0; i < needExtras; i++) {
            html += `<label>Traveler ${i + 2} full name *</label><input type="text" class="bk-extra-traveler" required minlength="2" autocomplete="name" />`;
        }
        extrasWrap.innerHTML = html;
    };
    syncBookingExtras();
    peopleEl?.addEventListener("input", syncBookingExtras);
    modal.querySelector("#bk_cancel")?.addEventListener("click", () => modal.remove());
    const runPay = (paymentKind) => {
        const date = modal.querySelector("#bk_date").value;
        const people = Number(modal.querySelector("#bk_people").value);
        const needExtras = Math.max(0, Math.min(19, people - 1));
        const extraNames = Array.from(modal.querySelectorAll(".bk-extra-traveler")).map((el) => el.value.trim());
        if (extraNames.length !== needExtras || (needExtras > 0 && extraNames.some((s) => s.length < 2))) {
            showMessagePopup("Please fill every additional traveler's name.", "error");
            return;
        }
        if (!isLoggedIn && !validateGuestBookingFields(modal).ok)
            return;
        const payAdvance = modal.querySelector("#bk_pay_advance");
        const payFull = modal.querySelector("#bk_pay_full");
        const setBusy = (label) => {
            if (payAdvance)
                payAdvance.disabled = true;
            if (payFull)
                payFull.disabled = true;
            if (paymentKind === "full" && payFull)
                payFull.textContent = label;
            else if (payAdvance)
                payAdvance.textContent = label;
        };
        const setIdle = () => {
            if (!modal.isConnected)
                return;
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
function renderTripCard(trip) {
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
            ${tripHasItineraryForTrip(trip)
        ? `<button type="button" class="btn-itinerary" data-itinerary-trip-id="${escapeHtml(trip._id)}">📋 Itinerary</button>`
        : ""}
            <a href="#" class="btn-book-now" data-book>📞 Book Now</a>
          </div>
        </div>
      </div>
    </article>`;
}
function attachTripInteractions() {
    const grid = document.getElementById("styleTripsGrid");
    if (!grid)
        return;
    grid.querySelectorAll("[data-book]").forEach((button) => {
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const card = event.currentTarget.closest(".trip-card");
            const trip = styleTrips.find((t) => t._id === card?.dataset.id);
            if (trip)
                openBookingModal(trip);
        });
    });
    grid.querySelectorAll("[data-itinerary-trip-id]").forEach((btn) => {
        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const id = btn.dataset.itineraryTripId || "";
            const trip = styleTrips.find((t) => t._id === id);
            if (trip)
                openItineraryModal(trip);
        });
    });
    grid.querySelectorAll(".trip-card").forEach((card) => {
        card.addEventListener("click", (event) => {
            const target = event.target;
            if (target.closest("[data-book]") || target.closest("[data-itinerary-trip-id]"))
                return;
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
const CINEMATIC_HERO_STYLES = [...TRIP_STYLE_ORDER];
function renderCinematicHeroHtml(style) {
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
function renderIntro() {
    const hero = document.getElementById("tripStylePageHero");
    if (!hero)
        return;
    hero.className = `trip-style-page-hero ${styleConfig.cssClass}`;
    if (CINEMATIC_HERO_STYLES.includes(styleConfig.slug)) {
        hero.innerHTML = renderCinematicHeroHtml(styleConfig);
    }
    else {
        hero.innerHTML = `
    <p class="trip-style-page-kicker">Wonder Baboon presents</p>
    <h1 class="trip-style-page-title" id="tripStylePageTitle">${escapeHtml(styleConfig.title)}</h1>
    <p class="trip-style-page-tagline">${escapeHtml(styleConfig.tagline)}</p>
    <div class="trip-style-page-intro">${renderStyleIntroHtml(styleConfig)}</div>`;
    }
    document.title = `${styleConfig.title} · Wonder Baboon`;
    const headerTitle = document.getElementById("stylePageHeaderTitle");
    if (headerTitle)
        headerTitle.textContent = styleConfig.shortLabel;
}
function renderTripsGrid(trips) {
    const grid = document.getElementById("styleTripsGrid");
    const countEl = document.getElementById("styleTripsCount");
    if (!grid)
        return;
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
async function loadStyleTrips() {
    const grid = document.getElementById("styleTripsGrid");
    if (grid)
        grid.innerHTML = '<p class="style-trips-loading">Loading trips…</p>';
    try {
        const response = await fetch(`${API_BASE_URL}/trips`);
        const payload = (await response.json());
        if (!response.ok)
            throw new Error(await parseError(response, payload));
        styleTrips = (payload.trips || []).filter((trip) => normalizeTripStyle(trip.tripStyle) === normalizeTripStyle(styleSlug));
        renderTripsGrid(styleTrips);
    }
    catch (error) {
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
