const ENV_API_BASE = window.__WB_API_BASE__;
const SERVER_HOSTS = new Set(["localhost", "72.60.200.102", ""]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", ""]);
function resolveApiBase() {
    if (ENV_API_BASE)
        return ENV_API_BASE.replace(/\/$/, "");
    const { protocol, hostname } = window.location;
    if (SERVER_HOSTS.has(hostname)) {
        return "http://api.wonderbaboon.com/api";
    }
    if (LOCAL_HOSTS.has(hostname)) {
        return "http://localhost:5051/api";
    }
    return `${protocol}//${hostname}/api`;
}
export const API_BASE_URL = resolveApiBase();
export const logger = {
    info: (...args) => console.info("[wb]", ...args),
    warn: (...args) => console.warn("[wb]", ...args),
    error: (...args) => console.error("[wb]", ...args),
};
export function getSession() {
    const token = localStorage.getItem("wb_token");
    const raw = localStorage.getItem("wb_user");
    const user = raw ? JSON.parse(raw) : null;
    return { token, user };
}
export function saveSession(token, user) {
    localStorage.setItem("wb_token", token);
    localStorage.setItem("wb_user", JSON.stringify(user));
}
export function clearSession() {
    localStorage.removeItem("wb_token");
    localStorage.removeItem("wb_user");
}
export function normalizeImageUrl(url) {
    if (!url)
        return "./assets/lake.jpg";
    if (url.startsWith("./assets/") || url.startsWith("assets/")) {
        return url.startsWith("./") ? url : `./${url}`;
    }
    return `./assets/${url.split("/").pop()}`;
}
export function updateHeaderAuth() {
    const greeting = document.getElementById("logoGreeting");
    const { token, user } = getSession();
    if (!greeting)
        return;
    if (token && user?.role === "user") {
        const label = user.name || user.email || "Traveler";
        greeting.textContent = `Hi, ${label}`;
        greeting.style.display = "block";
    }
    else if (token && user?.role === "admin") {
        greeting.textContent = "Admin";
        greeting.style.display = "block";
    }
    else {
        greeting.textContent = "";
        greeting.style.display = "none";
    }
}
export function smoothScrollToAnchor(href) {
    if (!href.startsWith("#"))
        return;
    const id = href.slice(1);
    if (!id) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
    }
    const el = document.getElementById(id);
    if (!el)
        return;
    const headerOffset = 70;
    const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
    window.scrollTo({ top, behavior: "smooth" });
}
export function attachSmoothScroll(scope = document) {
    scope.querySelectorAll('a[href^="#"]').forEach((a) => {
        a.addEventListener("click", (event) => {
            const href = a.getAttribute("href") || "";
            if (href.length <= 1)
                return;
            event.preventDefault();
            smoothScrollToAnchor(href);
        });
    });
}
export function showMessagePopup(message, type = "success") {
    const el = document.createElement("div");
    el.className = `notification ${type} show`;
    el.innerHTML = `
    <span>${message}</span>
    <button class="close-note" style="margin-left:10px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;">&times;</button>
  `;
    document.body.appendChild(el);
    const remove = () => el.remove();
    el.querySelector(".close-note")?.addEventListener("click", remove);
    setTimeout(remove, 4000);
}
export function showSuccessModal(title, message, ctaLabel = "Great!") {
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
        if (event.target === wrap)
            close();
    });
}
export async function parseError(response, data) {
    const body = data ?? (await response.json().catch(() => ({})));
    const detail = body.detail;
    if (Array.isArray(detail)) {
        return detail.map((item) => item.msg || "Request failed").join(", ");
    }
    return typeof detail === "string" ? detail : "Request failed";
}
export function parseTravelDate(dateStr) {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
}
export function isUpcomingTravelDate(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return parseTravelDate(dateStr) >= today;
}
