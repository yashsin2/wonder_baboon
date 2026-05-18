import { API_BASE_URL, clearSession, getSession, isUpcomingTravelDate, logger, parseError, saveSession, showMessagePopup, showSuccessModal, updateHeaderAuth, } from "./config.js";
import { getItineraryHtml } from "./trip-itineraries.js";
const page = (document.body.dataset.page || "");
function authHeaders() {
    const { token } = getSession();
    return token ? { Authorization: `Bearer ${token}` } : {};
}
async function apiFetch(path, init = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...init.headers,
    };
    return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}
function loginPrompt(message) {
    return `
    <div class="route-empty">
      <p>${message}</p>
      <a href="./auth.html" class="route-empty-cta">Login or sign up</a>
    </div>`;
}
function escapeHtml(raw) {
    return raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
/** Populated when bookings list is loaded; used for detail modal */
const bookingDetailById = new Map();
function bookingTravelersDisplay(b) {
    if (Array.isArray(b.travelers) && b.travelers.length) {
        return b.travelers.map((n) => String(n));
    }
    const out = [];
    if (b.fullName)
        out.push(String(b.fullName));
    const rec = b;
    for (let i = 2; i <= 20; i++) {
        const v = rec[`traveler${i}`];
        if (v)
            out.push(String(v));
    }
    return out;
}
function bookingItinerarySectionHtml(booking) {
    const fromDb = (booking.itineraryHtml || "").trim();
    const body = fromDb || getItineraryHtml(String(booking.travelDestination ?? ""), "") || "";
    if (!body)
        return "";
    return `<section class="booking-detail-itinerary"><h4>Itinerary</h4><div class="itinerary-modal-body booking-detail-itinerary-inner">${body}</div></section>`;
}
function openBookingDetailModal(booking) {
    const dest = escapeHtml(String(booking.travelDestination ?? ""));
    const pay = booking.payment === "paid" ? "Paid / confirmed" : "Pending payment";
    const tripBadge = booking.tripType === "defined_trip"
        ? `<span class="badge defined">Packaged trip</span>`
        : `<span class="badge planned">Planned trip</span>`;
    const names = bookingTravelersDisplay(booking);
    const travelersHtml = names.length > 0
        ? `<ol class="booking-detail-travelers">${names.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ol>`
        : `<p class="muted">No traveler list on file for this booking.</p>`;
    const itineraryBlock = bookingItinerarySectionHtml(booking);
    const wrap = document.createElement("div");
    wrap.className = "wb-modal";
    wrap.innerHTML = `
    <div class="wb-modal-card wb-modal-card--wide wb-modal-card--tall booking-detail-shell">
      <div class="wb-modal-head">
        <h3>Your trip · ${dest}</h3>
        <button type="button" class="wb-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="wb-modal-body-scroll booking-detail-body">
        <div class="booking-detail-chips">${tripBadge}<span class="booking-detail-pay">${escapeHtml(pay)}</span></div>
        <div class="booking-detail-grid">
          <div>
            <div class="booking-detail-row"><span class="k">Travel date</span><span class="v">${escapeHtml(new Date(booking.dateOfTravel).toLocaleDateString())}</span></div>
            <div class="booking-detail-row"><span class="k">Travelers</span><span class="v">${booking.numberOfPeople}</span></div>
            <div class="booking-detail-row"><span class="k">Booked on</span><span class="v">${escapeHtml(new Date(booking.createdAt).toLocaleDateString())}</span></div>
          </div>
          <div>
            <div class="booking-detail-row"><span class="k">Contact</span><span class="v">${escapeHtml(String(booking.mobile ?? "—"))}</span></div>
            <div class="booking-detail-row"><span class="k">Email</span><span class="v">${escapeHtml(String(booking.email ?? "—"))}</span></div>
            ${booking.tripId
        ? `<div class="booking-detail-row"><span class="k">Trip ID</span><span class="v">${escapeHtml(String(booking.tripId))}</span></div>`
        : ""}
          </div>
        </div>
        <div class="booking-detail-names-block">
          <h4>Traveler names</h4>
          ${travelersHtml}
        </div>
        ${itineraryBlock}
      </div>
    </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector(".wb-modal-close")?.addEventListener("click", close);
    wrap.addEventListener("click", (e) => {
        if (e.target === wrap)
            close();
    });
}
function upcomingPaymentNote(booking) {
    const paid = booking.payment === "paid";
    if (paid) {
        return `<p class="route-booking-payment route-booking-payment--confirmed">Booking confirmed.</p>`;
    }
    return `<p class="route-booking-payment route-booking-payment--pending">Your booking will be confirmed after advance payment.</p>`;
}
function renderBookingsToList(target, items, emptyMsg, options) {
    const showPaymentNote = options?.showPaymentNote ?? false;
    const neonPrevious = options?.emptyNeonPrevious ?? false;
    if (!items.length) {
        if (neonPrevious) {
            const msg = escapeHtml(emptyMsg);
            target.innerHTML = `<div class="route-empty route-empty--previous-neon" role="status"><span class="route-empty-neon-text">${msg}</span></div>`;
            return;
        }
        target.innerHTML = `<div class="route-empty"><p>${escapeHtml(emptyMsg)}</p></div>`;
        return;
    }
    target.innerHTML = items
        .map((b) => {
        const dest = escapeHtml(String(b.travelDestination ?? ""));
        const bid = escapeHtml(String(b._id ?? ""));
        const paymentBlock = showPaymentNote ? upcomingPaymentNote(b) : "";
        return `
      <article class="route-booking route-booking--interactive" data-booking-id="${bid}" role="button" tabindex="0" aria-label="View booking details for ${dest}">
        <header>
          <h3>${dest}</h3>
          <span class="badge ${b.tripType === "defined_trip" ? "defined" : "planned"}">
            ${b.tripType === "defined_trip" ? "Trip" : "Planned"}
          </span>
        </header>
        <ul class="route-booking-meta">
          <li>📅 <strong>${new Date(b.dateOfTravel).toLocaleDateString()}</strong></li>
          <li>👥 ${b.numberOfPeople} traveler${b.numberOfPeople > 1 ? "s" : ""}</li>
          <li>🕒 Booked ${new Date(b.createdAt).toLocaleDateString()}</li>
        </ul>
        ${paymentBlock}
      </article>`;
    })
        .join("");
}
async function mountBookingsPage(kind) {
    const list = document.getElementById(kind === "upcoming" ? "upcomingList" : "previousList");
    if (!list)
        return;
    const { token, user } = getSession();
    if (!token || !user) {
        list.innerHTML = loginPrompt(kind === "upcoming" ? "Log in to see your trips." : "Log in to see your previous travels.");
        return;
    }
    list.innerHTML =
        kind === "previous"
            ? `<div class="route-loading route-loading--previous" aria-live="polite">Loading…</div>`
            : `<div class="route-empty"><p>Loading…</p></div>`;
    try {
        const res = await apiFetch("/user/bookings");
        const data = (await res.json());
        if (!res.ok)
            throw new Error(await parseError(res, data));
        const filtered = kind === "upcoming"
            ? data.bookings.filter((b) => isUpcomingTravelDate(b.dateOfTravel))
            : data.bookings.filter((b) => !isUpcomingTravelDate(b.dateOfTravel));
        bookingDetailById.clear();
        filtered.forEach((b) => bookingDetailById.set(b._id, b));
        renderBookingsToList(list, filtered, kind === "upcoming" ? "No trips booked yet. Find one on the home page." : "no previous travel yet.", { showPaymentNote: kind === "upcoming", emptyNeonPrevious: kind === "previous" });
    }
    catch (error) {
        logger.error("mountBookingsPage", error);
        list.innerHTML = `<div class="route-empty"><p>${error instanceof Error ? error.message : "Failed to load bookings"}</p></div>`;
    }
}
function settingsForm(profile) {
    return `
    <div class="route-card">
      <div class="up-setting">
        <label>Full name</label>
        <div class="up-row">
          <input id="settingName" type="text" value="${profile.name || ""}" />
          <button id="saveName" type="button" class="up-btn">Save</button>
        </div>
      </div>
      <div class="up-setting">
        <label>Email</label>
        <div class="up-row">
          <input id="settingEmail" type="email" value="${profile.email || ""}" />
          <button id="changeEmail" type="button" class="up-btn">Change</button>
        </div>
        <small class="muted">An OTP will be sent to the new email.</small>
      </div>
      <div class="up-setting">
        <label>Mobile</label>
        <div class="up-row">
          <input id="settingMobile" type="tel" value="${profile.mobile || ""}" />
          <button id="changeMobile" type="button" class="up-btn">Change</button>
        </div>
        <small class="muted">An OTP will be sent to your registered email.</small>
      </div>
      <button id="signOut" type="button" class="up-btn-danger">Sign out</button>
    </div>`;
}
async function mountSettingsPage() {
    const body = document.getElementById("settingsBody");
    if (!body)
        return;
    const { token, user } = getSession();
    if (!token || !user) {
        body.innerHTML = loginPrompt("Log in to edit your profile.");
        return;
    }
    body.innerHTML = `<div class="route-empty"><p>Loading…</p></div>`;
    try {
        const res = await apiFetch("/user/profile");
        const profile = (await res.json());
        if (!res.ok)
            throw new Error(await parseError(res, profile));
        body.innerHTML = settingsForm(profile);
        document.getElementById("saveName")?.addEventListener("click", () => void saveName());
        document.getElementById("changeEmail")?.addEventListener("click", () => void startChangeEmail());
        document.getElementById("changeMobile")?.addEventListener("click", () => void startChangeMobile());
        document.getElementById("signOut")?.addEventListener("click", () => {
            clearSession();
            window.location.href = "./index.html";
        });
    }
    catch (error) {
        logger.error("mountSettingsPage", error);
        body.innerHTML = `<div class="route-empty"><p>${error instanceof Error ? error.message : "Failed to load profile"}</p></div>`;
    }
}
async function saveName() {
    const name = document.getElementById("settingName").value.trim();
    if (!name) {
        showMessagePopup("Name cannot be empty", "error");
        return;
    }
    try {
        const res = await apiFetch("/user/profile", { method: "PATCH", body: JSON.stringify({ name }) });
        if (!res.ok)
            throw new Error(await parseError(res));
        const session = getSession();
        if (session.token && session.user)
            saveSession(session.token, { ...session.user, name });
        document.getElementById("logoGreeting").textContent = `Hi, ${name}`;
        showSuccessModal("Name updated", "Your profile name has been changed.");
    }
    catch (error) {
        showMessagePopup(error instanceof Error ? error.message : "Failed to update name", "error");
    }
}
async function startChangeEmail() {
    const newEmail = document.getElementById("settingEmail").value.trim();
    if (!newEmail)
        return showMessagePopup("Enter a new email", "error");
    try {
        const res = await apiFetch("/user/profile/email-otp/request", {
            method: "POST",
            body: JSON.stringify({ new_email: newEmail }),
        });
        if (!res.ok)
            throw new Error(await parseError(res));
        promptOtp("email", newEmail);
    }
    catch (error) {
        showMessagePopup(error instanceof Error ? error.message : "Failed to request OTP", "error");
    }
}
async function startChangeMobile() {
    const newMobile = document.getElementById("settingMobile").value.trim();
    if (!newMobile)
        return showMessagePopup("Enter a new mobile", "error");
    try {
        const res = await apiFetch("/user/profile/mobile-otp/request", {
            method: "POST",
            body: JSON.stringify({ new_mobile: newMobile }),
        });
        if (!res.ok)
            throw new Error(await parseError(res));
        promptOtp("mobile", newMobile);
    }
    catch (error) {
        showMessagePopup(error instanceof Error ? error.message : "Failed to request OTP", "error");
    }
}
function promptOtp(kind, newValue) {
    document.getElementById("otpModal")?.remove();
    const wrap = document.createElement("div");
    wrap.id = "otpModal";
    wrap.className = "wb-modal";
    wrap.innerHTML = `
    <div class="wb-modal-card">
      <h3>Enter verification code</h3>
      <p class="muted">We sent a 6-digit code to ${kind === "email" ? `<strong>${newValue}</strong>` : "your registered email"}.</p>
      <input id="otpCodeInput" class="otp-input" inputmode="numeric" maxlength="6" placeholder="••••••" />
      <div class="wb-modal-actions">
        <button id="otpCancel" type="button" class="wb-cancel">Cancel</button>
        <button id="otpSubmit" type="button" class="wb-primary">Verify</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector("#otpCodeInput").focus();
    wrap.querySelector("#otpCancel")?.addEventListener("click", () => wrap.remove());
    wrap.querySelector("#otpSubmit")?.addEventListener("click", async () => {
        const code = wrap.querySelector("#otpCodeInput").value.trim();
        if (!/^\d{4,10}$/.test(code))
            return showMessagePopup("Enter the numeric code", "error");
        try {
            const path = kind === "email" ? "/user/profile/email-otp/verify" : "/user/profile/mobile-otp/verify";
            const res = await apiFetch(path, { method: "POST", body: JSON.stringify({ code }) });
            const data = (await res.json());
            if (!res.ok)
                throw new Error(await parseError(res, data));
            if (kind === "email" && data.token && data.user) {
                saveSession(data.token, { name: data.user.name, email: data.user.email, role: "user" });
                showSuccessModal("Email updated", "Your account email has been changed.");
            }
            else if (kind === "mobile") {
                showSuccessModal("Mobile updated", "Your mobile number has been changed.");
            }
            wrap.remove();
            await mountSettingsPage();
        }
        catch (error) {
            showMessagePopup(error instanceof Error ? error.message : "Verification failed", "error");
        }
    });
}
function syncRouteHeroHeaderGap() {
    const kind = document.body.dataset.page || "";
    if (kind !== "upcoming" && kind !== "previous")
        return;
    const header = document.querySelector(".site-header");
    const apply = () => {
        const h = header?.offsetHeight ?? 76;
        document.documentElement.style.setProperty("--wb-route-hero-header-gap", `${h}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    if (header && typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(apply);
        ro.observe(header);
    }
}
function registerBookingCardInteraction() {
    const handler = (event) => {
        const article = event.target.closest("[data-booking-id]");
        if (!article)
            return;
        const id = article.getAttribute("data-booking-id");
        if (!id || !bookingDetailById.has(id))
            return;
        event.preventDefault();
        openBookingDetailModal(bookingDetailById.get(id));
    };
    document.getElementById("upcomingList")?.addEventListener("click", handler);
    document.getElementById("previousList")?.addEventListener("click", handler);
}
document.addEventListener("DOMContentLoaded", () => {
    updateHeaderAuth();
    syncRouteHeroHeaderGap();
    registerBookingCardInteraction();
    if (page === "upcoming")
        void mountBookingsPage("upcoming");
    else if (page === "previous")
        void mountBookingsPage("previous");
    else if (page === "settings")
        void mountSettingsPage();
});
