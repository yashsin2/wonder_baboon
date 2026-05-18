import {
  API_BASE_URL,
  Booking,
  clearSession,
  getSession,
  isUpcomingTravelDate,
  logger,
  parseError,
  saveSession,
  showMessagePopup,
  showSuccessModal,
  updateHeaderAuth,
} from "./config.js";

interface ProfileResponse {
  name: string;
  email: string;
  mobile: string;
}

interface BookingsResponse {
  bookings: Booking[];
}

type Page = "upcoming" | "previous" | "settings";

const page = (document.body.dataset.page || "") as Page | "";

function authHeaders(): Record<string, string> {
  const { token } = getSession();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

function loginPrompt(message: string): string {
  return `
    <div class="route-empty">
      <p>${message}</p>
      <a href="./auth.html" class="route-empty-cta">Login or sign up</a>
    </div>`;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function upcomingPaymentNote(booking: Booking): string {
  const paid = booking.payment === "paid";
  if (paid) {
    return `<p class="route-booking-payment route-booking-payment--confirmed">Booking confirmed.</p>`;
  }
  return `<p class="route-booking-payment route-booking-payment--pending">Your booking will be confirmed after advance payment.</p>`;
}

function renderBookingsToList(
  target: HTMLElement,
  items: Booking[],
  emptyMsg: string,
  options?: { showPaymentNote?: boolean; emptyNeonPrevious?: boolean }
): void {
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
      const paymentBlock = showPaymentNote ? upcomingPaymentNote(b) : "";
      return `
      <article class="route-booking">
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

async function mountBookingsPage(kind: "upcoming" | "previous"): Promise<void> {
  const list = document.getElementById(kind === "upcoming" ? "upcomingList" : "previousList");
  if (!list) return;
  const { token, user } = getSession();
  if (!token || !user) {
    list.innerHTML = loginPrompt(
      kind === "upcoming" ? "Log in to see your trips." : "Log in to see your previous travels."
    );
    return;
  }
  list.innerHTML =
    kind === "previous"
      ? `<div class="route-loading route-loading--previous" aria-live="polite">Loading…</div>`
      : `<div class="route-empty"><p>Loading…</p></div>`;
  try {
    const res = await apiFetch("/user/bookings");
    const data = (await res.json()) as BookingsResponse & { detail?: string };
    if (!res.ok) throw new Error(await parseError(res, data));
    const filtered =
      kind === "upcoming"
        ? data.bookings.filter((b) => isUpcomingTravelDate(b.dateOfTravel))
        : data.bookings.filter((b) => !isUpcomingTravelDate(b.dateOfTravel));
    renderBookingsToList(
      list,
      filtered,
      kind === "upcoming" ? "No trips booked yet. Find one on the home page." : "no previous travel yet.",
      { showPaymentNote: kind === "upcoming", emptyNeonPrevious: kind === "previous" }
    );
  } catch (error) {
    logger.error("mountBookingsPage", error);
    list.innerHTML = `<div class="route-empty"><p>${error instanceof Error ? error.message : "Failed to load bookings"}</p></div>`;
  }
}

function settingsForm(profile: ProfileResponse): string {
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

async function mountSettingsPage(): Promise<void> {
  const body = document.getElementById("settingsBody");
  if (!body) return;
  const { token, user } = getSession();
  if (!token || !user) {
    body.innerHTML = loginPrompt("Log in to edit your profile.");
    return;
  }
  body.innerHTML = `<div class="route-empty"><p>Loading…</p></div>`;
  try {
    const res = await apiFetch("/user/profile");
    const profile = (await res.json()) as ProfileResponse & { detail?: string };
    if (!res.ok) throw new Error(await parseError(res, profile));
    body.innerHTML = settingsForm(profile);
    document.getElementById("saveName")?.addEventListener("click", () => void saveName());
    document.getElementById("changeEmail")?.addEventListener("click", () => void startChangeEmail());
    document.getElementById("changeMobile")?.addEventListener("click", () => void startChangeMobile());
    document.getElementById("signOut")?.addEventListener("click", () => {
      clearSession();
      window.location.href = "./index.html";
    });
  } catch (error) {
    logger.error("mountSettingsPage", error);
    body.innerHTML = `<div class="route-empty"><p>${error instanceof Error ? error.message : "Failed to load profile"}</p></div>`;
  }
}

async function saveName(): Promise<void> {
  const name = (document.getElementById("settingName") as HTMLInputElement).value.trim();
  if (!name) {
    showMessagePopup("Name cannot be empty", "error");
    return;
  }
  try {
    const res = await apiFetch("/user/profile", { method: "PATCH", body: JSON.stringify({ name }) });
    if (!res.ok) throw new Error(await parseError(res));
    const session = getSession();
    if (session.token && session.user) saveSession(session.token, { ...session.user, name });
    document.getElementById("logoGreeting")!.textContent = `Hi, ${name}`;
    showSuccessModal("Name updated", "Your profile name has been changed.");
  } catch (error) {
    showMessagePopup(error instanceof Error ? error.message : "Failed to update name", "error");
  }
}

async function startChangeEmail(): Promise<void> {
  const newEmail = (document.getElementById("settingEmail") as HTMLInputElement).value.trim();
  if (!newEmail) return showMessagePopup("Enter a new email", "error");
  try {
    const res = await apiFetch("/user/profile/email-otp/request", {
      method: "POST",
      body: JSON.stringify({ new_email: newEmail }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    promptOtp("email", newEmail);
  } catch (error) {
    showMessagePopup(error instanceof Error ? error.message : "Failed to request OTP", "error");
  }
}

async function startChangeMobile(): Promise<void> {
  const newMobile = (document.getElementById("settingMobile") as HTMLInputElement).value.trim();
  if (!newMobile) return showMessagePopup("Enter a new mobile", "error");
  try {
    const res = await apiFetch("/user/profile/mobile-otp/request", {
      method: "POST",
      body: JSON.stringify({ new_mobile: newMobile }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    promptOtp("mobile", newMobile);
  } catch (error) {
    showMessagePopup(error instanceof Error ? error.message : "Failed to request OTP", "error");
  }
}

function promptOtp(kind: "email" | "mobile", newValue: string): void {
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
  (wrap.querySelector("#otpCodeInput") as HTMLInputElement).focus();
  wrap.querySelector("#otpCancel")?.addEventListener("click", () => wrap.remove());
  wrap.querySelector("#otpSubmit")?.addEventListener("click", async () => {
    const code = (wrap.querySelector("#otpCodeInput") as HTMLInputElement).value.trim();
    if (!/^\d{4,10}$/.test(code)) return showMessagePopup("Enter the numeric code", "error");
    try {
      const path = kind === "email" ? "/user/profile/email-otp/verify" : "/user/profile/mobile-otp/verify";
      const res = await apiFetch(path, { method: "POST", body: JSON.stringify({ code }) });
      const data = (await res.json()) as {
        detail?: string;
        token?: string;
        user?: { name?: string; email?: string };
      };
      if (!res.ok) throw new Error(await parseError(res, data));
      if (kind === "email" && data.token && data.user) {
        saveSession(data.token, { name: data.user.name, email: data.user.email, role: "user" });
        showSuccessModal("Email updated", "Your account email has been changed.");
      } else if (kind === "mobile") {
        showSuccessModal("Mobile updated", "Your mobile number has been changed.");
      }
      wrap.remove();
      await mountSettingsPage();
    } catch (error) {
      showMessagePopup(error instanceof Error ? error.message : "Verification failed", "error");
    }
  });
}

function syncRouteHeroHeaderGap(): void {
  const kind = document.body.dataset.page || "";
  if (kind !== "upcoming" && kind !== "previous") return;
  const header = document.querySelector<HTMLElement>(".site-header");
  const apply = (): void => {
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

document.addEventListener("DOMContentLoaded", () => {
  updateHeaderAuth();
  syncRouteHeroHeaderGap();
  if (page === "upcoming") void mountBookingsPage("upcoming");
  else if (page === "previous") void mountBookingsPage("previous");
  else if (page === "settings") void mountSettingsPage();
});
