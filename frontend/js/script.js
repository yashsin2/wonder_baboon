import { API_BASE_URL, attachSmoothScroll, getSession, logger, normalizeImageUrl, parseError, parseTravelDate, showMessagePopup, showSuccessModal, updateHeaderAuth, } from "./config.js";
import { getItineraryHtmlForTrip, tripHasItineraryForTrip } from "./trip-itineraries.js";
import { TRIP_STYLE_ORDER } from "./trip-styles.js";
let tripsSwiper = null;
const mobileMenuBtn = document.querySelector(".mobile-menu-btn");
const navLinks = document.querySelector(".nav-links");
const tripsContainer = document.getElementById("tripsContainer");
const searchInput = document.querySelector("#headerTripSearch");
const searchButton = document.querySelector("#headerTripSearchBtn");
const planButton = document.getElementById("planTripBtn");
const planDestinationInput = document.getElementById("planDestination");
const planDateInput = document.getElementById("planDate");
let allTrips = [];
function escapeHtml(raw) {
    return raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function tripMatchesTerm(trip, term) {
    const t = term.trim().toLowerCase();
    if (!t)
        return true;
    return `${trip.title} ${trip.location}`.toLowerCase().includes(t);
}
function scrollTripsIntoView() {
    document.getElementById("trips")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
const TRAVEL_STYLE_SLUGS = new Set(TRIP_STYLE_ORDER);
/** Active vibe filter on home upcoming-trips chips (panel links still go to style pages). */
let activeStyleChip = "backpackers";
function syncStyleChipUi() {
    document.querySelectorAll("[data-style-chip]").forEach((chip) => {
        const isActive = chip.dataset.styleChip === activeStyleChip;
        chip.classList.toggle("active", isActive);
        chip.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    const heroEl = document.getElementById("heroTravelStyle");
    if (heroEl)
        heroEl.value = activeStyleChip;
}
function setupStyleChipFilters() {
    document.querySelectorAll("[data-style-chip]").forEach((chip) => {
        chip.addEventListener("click", () => {
            const slug = (chip.dataset.styleChip || "").trim();
            if (!slug || !TRAVEL_STYLE_SLUGS.has(slug))
                return;
            activeStyleChip = activeStyleChip === slug ? "" : slug;
            syncStyleChipUi();
            filterTripsAndReveal({ scroll: true });
        });
    });
}
function filterTripsCatalog(filters) {
    let list = [...allTrips];
    const dest = (filters.destination || "").trim().toLowerCase();
    if (dest) {
        list = list.filter((trip) => tripMatchesTerm(trip, dest));
    }
    const style = (filters.travelStyle || "").trim().toLowerCase();
    if (style && TRAVEL_STYLE_SLUGS.has(style)) {
        list = list.filter((trip) => (trip.tripStyle || "backpackers") === style);
    }
    const dateStr = (filters.date || "").trim();
    if (dateStr) {
        try {
            const userMid = new Date(`${dateStr}T12:00:00`);
            list = list.filter((trip) => {
                if (!trip.startDate)
                    return true;
                const sd = parseTravelDate(trip.startDate);
                sd.setHours(0, 0, 0, 0);
                const ed = trip.endDate ? parseTravelDate(trip.endDate) : new Date(sd.getTime());
                ed.setHours(23, 59, 59, 999);
                const u = new Date(userMid);
                u.setHours(12, 0, 0, 0);
                return u >= sd && u <= ed;
            });
        }
        catch {
            /* ignore invalid date */
        }
    }
    return list;
}
function setupMobileMenu() {
    if (!mobileMenuBtn || !navLinks)
        return;
    mobileMenuBtn.addEventListener("click", () => {
        navLinks.classList.toggle("active");
        mobileMenuBtn.classList.toggle("active");
    });
}
function createWbModal(title, bodyHtml, options) {
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
        if (event.target === modal)
            modal.remove();
    });
    return modal;
}
function openItineraryModal(trip) {
    const html = getItineraryHtmlForTrip(trip);
    if (!html)
        return;
    const safe = escapeHtml(trip.title);
    createWbModal(`Itinerary · ${safe}`, `<div class="wb-modal-body-scroll itinerary-modal-body">${html}</div>`, { wide: true, tall: true });
}
function todayIso() {
    return new Date().toISOString().slice(0, 10);
}
function openBookingModal(trip) {
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
      <div class="wb-modal-actions">
        <button type="button" class="wb-cancel" id="bk_cancel">Cancel</button>
        <button type="submit" class="wb-primary" id="bk_submit">Confirm booking</button>
      </div>
    </form>
  `;
    const modal = createWbModal(`Book: ${escapeHtml(trip.title)}`, body);
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
            const num = i + 2;
            html += `<label>Traveler ${num} full name *</label><input type="text" class="bk-extra-traveler" required minlength="2" autocomplete="name" />`;
        }
        extrasWrap.innerHTML = html;
    };
    syncBookingExtras();
    peopleEl?.addEventListener("input", syncBookingExtras);
    modal.querySelector("#bk_cancel")?.addEventListener("click", () => modal.remove());
    modal.querySelector("#bk_form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const date = modal.querySelector("#bk_date").value;
        const people = Number(modal.querySelector("#bk_people").value);
        if (!date) {
            showMessagePopup("Please choose a date of travel", "error");
            return;
        }
        if (!Number.isFinite(people) || people < 1) {
            showMessagePopup("Number of people must be at least 1", "error");
            return;
        }
        const needExtras = Math.max(0, Math.min(19, people - 1));
        const extraNames = Array.from(modal.querySelectorAll(".bk-extra-traveler")).map((el) => el.value.trim());
        if (extraNames.length !== needExtras) {
            showMessagePopup("Please fill every additional traveler's name.", "error");
            return;
        }
        if (needExtras > 0 && extraNames.some((s) => s.length < 2)) {
            showMessagePopup("Each traveler's name must be at least 2 characters.", "error");
            return;
        }
        const submitBtn = modal.querySelector("#bk_submit");
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Booking…";
        }
        try {
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
                if (!res.ok)
                    throw new Error(await parseError(res));
            }
            else {
                const name = modal.querySelector("#bk_name").value.trim();
                const mobile = modal.querySelector("#bk_mobile").value.trim();
                const email = modal.querySelector("#bk_email").value.trim();
                if (!name || !mobile) {
                    showMessagePopup("Name and mobile are required", "error");
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Confirm booking";
                    }
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
                if (!res.ok)
                    throw new Error(await parseError(res));
            }
            modal.remove();
            showSuccessModal("Booking confirmed", `Your booking for ${trip.title} on ${date} is in. Our team will reach out shortly.`);
            logger.info("booking confirmed", { trip: trip.title, date, people });
        }
        catch (error) {
            logger.error("booking failed", error);
            showMessagePopup(error instanceof Error ? error.message : "Booking failed", "error");
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Confirm booking";
            }
        }
    });
}
function setupItineraryButtons() {
    if (!tripsContainer)
        return;
    tripsContainer.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-itinerary-trip-id]");
        if (!btn)
            return;
        event.preventDefault();
        event.stopPropagation();
        const id = btn.dataset.itineraryTripId || "";
        const trip = allTrips.find((item) => item._id === id);
        if (trip)
            openItineraryModal(trip);
    });
}
function attachBookHandlers() {
    document.querySelectorAll("[data-book]").forEach((button) => {
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const card = event.currentTarget.closest(".trip-card");
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
function renderTripCard(trip) {
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
              ${tripHasItineraryForTrip(trip)
        ? `<button type="button" class="btn-itinerary" data-itinerary-trip-id="${escapeHtml(trip._id)}">📋 Itinerary</button>`
        : ""}
              <a href="#" class="btn-book-now" data-book>📞 Book Now</a>
            </div>
          </div>
        </div>
      </article>
    </div>`;
}
function initTripsSwiper() {
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
function renderTrips(trips, options) {
    if (!tripsContainer)
        return;
    const emptyHint = options?.emptyHint ?? "No trips available right now.";
    if (!trips.length) {
        tripsContainer.innerHTML = `<div class="swiper-slide"><div class="trip-empty">${emptyHint}</div></div>`;
    }
    else {
        tripsContainer.innerHTML = trips.map(renderTripCard).join("");
    }
    attachBookHandlers();
    initTripsSwiper();
}
async function loadTrips() {
    try {
        const response = await fetch(`${API_BASE_URL}/trips`);
        const text = await response.text();
        let payload = {};
        if (text) {
            try {
                payload = JSON.parse(text);
            }
            catch {
                throw new Error("Could not load trips — the server sent an invalid response. Try Ctrl+Shift+R (hard refresh) or clear cached files for this site.");
            }
        }
        if (!response.ok)
            throw new Error(await parseError(response, payload));
        allTrips = payload.trips || [];
        syncStyleChipUi();
        filterTripsAndReveal();
    }
    catch (error) {
        const msg = error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("Load failed"))
            ? "Can't reach the trip server. Check your connection or try again."
            : error instanceof Error
                ? error.message
                : "Trips could not be loaded.";
        showMessagePopup(msg, "error");
    }
}
function filterTripsAndReveal(opts) {
    const term = (searchInput?.value || "").trim().toLowerCase();
    let filtered = !term ? [...allTrips] : allTrips.filter((trip) => tripMatchesTerm(trip, term));
    if (activeStyleChip) {
        filtered = filtered.filter((trip) => (trip.tripStyle || "backpackers") === activeStyleChip);
    }
    const emptyHint = filtered.length === 0
        ? activeStyleChip || term
            ? "No trips match this filter. Try another vibe or clear the search."
            : undefined
        : undefined;
    renderTrips(filtered, emptyHint ? { emptyHint } : undefined);
    if (opts?.scroll)
        scrollTripsIntoView();
}
function handleHeroFindTrips() {
    const destination = planDestinationInput?.value?.trim() || "";
    const dateOfTravel = planDateInput?.value?.trim() || "";
    const travelStyleEl = document.getElementById("heroTravelStyle");
    const travelStyle = travelStyleEl?.value?.trim() || "";
    if (!destination && !travelStyle && !dateOfTravel) {
        showMessagePopup("Enter a destination, choose a travel vibe, or pick a date to search trips.", "error");
        return;
    }
    if (travelStyle && TRAVEL_STYLE_SLUGS.has(travelStyle)) {
        activeStyleChip = travelStyle;
        syncStyleChipUi();
    }
    const filtered = filterTripsCatalog({ destination, travelStyle, date: dateOfTravel });
    const emptyHint = filtered.length === 0
        ? "No packaged trips match those filters. Try adjusting them or search from the header."
        : undefined;
    renderTrips(filtered, emptyHint ? { emptyHint } : undefined);
    scrollTripsIntoView();
    if (filtered.length === 0) {
        if (destination && dateOfTravel) {
            void handlePlannedTrip();
        }
        else {
            showMessagePopup("No trips matched. Enter both destination and travel date to request a custom plan, or widen your search.", "error");
        }
    }
}
async function handlePlannedTrip() {
    const destination = planDestinationInput?.value?.trim();
    const dateOfTravel = planDateInput?.value;
    if (!destination || !dateOfTravel) {
        showMessagePopup("Please enter destination and date for planned trip", "error");
        return;
    }
    const body = `
    <p class="muted">Tell us how to reach you and we'll craft a custom plan.</p>
    <form id="plannedTripForm" novalidate>
      <label>Name *</label>
      <input id="plannedName" type="text" required minlength="2" />
      <label>Mobile *</label>
      <input id="plannedMobile" type="tel" required placeholder="10-digit Indian number" />
      <label>Email</label>
      <input id="plannedEmail" type="email" />
      <label>People *</label>
      <input id="plannedPeople" type="number" min="1" max="20" value="1" required />
      <div id="planned_extras_wrap" class="bk-extras-wrap" aria-live="polite"></div>
      <div class="wb-modal-actions">
        <button type="button" class="wb-cancel" id="planned_cancel">Cancel</button>
        <button type="submit" class="wb-primary" id="planned_submit">Submit</button>
      </div>
    </form>
  `;
    const modal = createWbModal(`Plan trip to ${escapeHtml(destination)}`, body);
    const plannedExtrasWrap = modal.querySelector("#planned_extras_wrap");
    const plannedPeopleEl = modal.querySelector("#plannedPeople");
    const syncPlannedExtras = () => {
        if (!plannedExtrasWrap || !plannedPeopleEl)
            return;
        const n = Number(plannedPeopleEl.value);
        const count = Number.isFinite(n) && n >= 1 ? Math.min(20, Math.floor(n)) : 1;
        const needExtras = Math.max(0, count - 1);
        plannedExtrasWrap.innerHTML = "";
        if (needExtras === 0)
            return;
        let html = "";
        for (let i = 0; i < needExtras; i++) {
            const num = i + 2;
            html += `<label>Traveler ${num} full name *</label><input type="text" class="planned-extra-traveler" required minlength="2" autocomplete="name" />`;
        }
        plannedExtrasWrap.innerHTML = html;
    };
    syncPlannedExtras();
    plannedPeopleEl?.addEventListener("input", syncPlannedExtras);
    modal.querySelector("#planned_cancel")?.addEventListener("click", () => modal.remove());
    modal.querySelector("#plannedTripForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = modal.querySelector("#plannedName").value.trim();
        const mobile = modal.querySelector("#plannedMobile").value.trim();
        if (!name || !mobile) {
            showMessagePopup("Name and mobile are required", "error");
            return;
        }
        const people = Number(modal.querySelector("#plannedPeople").value);
        const needExtras = Math.max(0, Math.min(19, people - 1));
        const extraNames = Array.from(modal.querySelectorAll(".planned-extra-traveler")).map((el) => el.value.trim());
        if (extraNames.length !== needExtras) {
            showMessagePopup("Please fill every additional traveler's name.", "error");
            return;
        }
        if (needExtras > 0 && extraNames.some((s) => s.length < 2)) {
            showMessagePopup("Each traveler's name must be at least 2 characters.", "error");
            return;
        }
        const submitBtn = modal.querySelector("#planned_submit");
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Submitting…";
        }
        try {
            const response = await fetch(`${API_BASE_URL}/planned-trips`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    travel_destination: destination,
                    date_of_travel: dateOfTravel,
                    full_name: name,
                    mobile,
                    email: modal.querySelector("#plannedEmail").value.trim() || null,
                    number_of_people: people,
                    additional_travelers: extraNames,
                }),
            });
            if (!response.ok)
                throw new Error(await parseError(response));
            modal.remove();
            if (planDestinationInput)
                planDestinationInput.value = "";
            if (planDateInput)
                planDateInput.value = "";
            showSuccessModal("Planned trip submitted", "Our team will contact you with a custom plan soon.");
        }
        catch (error) {
            showMessagePopup(error instanceof Error ? error.message : "Failed to save planned trip", "error");
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Submit";
            }
        }
    });
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
function setupParallax() {
    const prefersReducedMotion = typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
        logger.info("Parallax disabled: user prefers reduced motion");
        return;
    }
    const sections = Array.from(document.querySelectorAll(".trips, .about-us"));
    if (sections.length === 0)
        return;
    // Strength tuned so the photo lags subtly behind content (~22%).
    // The ::before pseudo is sized to allow up to 25% translation in either
    // direction, so this stays within bounds for any reasonable viewport.
    const PARALLAX_STRENGTH = 0.22;
    let frameRequested = false;
    const update = () => {
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
    const requestUpdate = () => {
        if (frameRequested)
            return;
        frameRequested = true;
        requestAnimationFrame(update);
    };
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });
    update();
    logger.info("Parallax initialised", { sections: sections.length });
}
function setupTripCardOpenDetail() {
    if (!tripsContainer)
        return;
    tripsContainer.addEventListener("click", (event) => {
        const target = event.target;
        if (target.closest("[data-book]") || target.closest("[data-itinerary-trip-id]"))
            return;
        const card = target.closest(".trip-card");
        if (!card?.dataset.id)
            return;
        const trip = allTrips.find((item) => item._id === card.dataset.id);
        if (!trip)
            return;
        event.preventDefault();
        event.stopPropagation();
        openTripDetailModal(trip);
    });
}
document.addEventListener("DOMContentLoaded", async () => {
    updateHeaderAuth();
    setupMobileMenu();
    attachSmoothScroll(document);
    setupParallax();
    setupStyleChipFilters();
    syncStyleChipUi();
    setupTripCardOpenDetail();
    setupItineraryButtons();
    await loadTrips();
    if (searchInput) {
        searchInput.addEventListener("input", () => filterTripsAndReveal({ scroll: false }));
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                filterTripsAndReveal({ scroll: true });
            }
        });
    }
    if (searchButton)
        searchButton.addEventListener("click", () => filterTripsAndReveal({ scroll: true }));
    if (planButton)
        planButton.addEventListener("click", handleHeroFindTrips);
});
