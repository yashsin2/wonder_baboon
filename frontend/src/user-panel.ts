import {
  clearSession,
  getSession,
  showSuccessModal,
} from "./config.js";

const panel = document.getElementById("userPanel");
const greetingEl = document.getElementById("panelGreeting");
const titleEl = document.getElementById("panelTitle");
const footerEl = document.getElementById("userPanelFoot");

function renderGreeting(): void {
  const { token, user } = getSession();
  if (token && user) {
    const displayName = user.name || user.email || "Traveler";
    if (titleEl) titleEl.textContent = `Hi, ${displayName.split(" ")[0]}`;
    if (greetingEl) greetingEl.textContent = user.email || "Welcome back!";
  } else {
    if (titleEl) titleEl.textContent = "Wonder Baboon";
    if (greetingEl) greetingEl.textContent = "Sign in to manage your trips";
  }
}

function renderFooter(): void {
  if (!footerEl) return;
  const { token, user } = getSession();
  if (token && user) {
    footerEl.innerHTML = `<button id="panelLogoutBtn" type="button" class="up-footer-btn up-logout-btn">Logout</button>`;
    document.getElementById("panelLogoutBtn")?.addEventListener("click", () => {
      clearSession();
      showSuccessModal("Logged out", "See you on the next adventure!");
      setTimeout(() => {
        window.location.href = "./index.html";
      }, 800);
    });
  } else {
    footerEl.innerHTML = `<a href="./auth.html" id="panelLoginBtn" class="up-footer-btn up-login-btn">Login / Sign up</a>`;
  }
}

function highlightActiveNav(): void {
  const currentPage = document.body.dataset.page || "home";
  document.querySelectorAll<HTMLAnchorElement>("[data-panel-nav] .up-nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === currentPage);
  });
}

function openPanel(): void {
  if (!panel) return;
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderGreeting();
  renderFooter();
  highlightActiveNav();
}

function closePanel(): void {
  if (!panel) return;
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.id === "openPanelBtn" || target.closest("#openPanelBtn")) {
    openPanel();
    return;
  }
  if (target.dataset.panelClose !== undefined || target.closest("[data-panel-close]")) {
    closePanel();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePanel();
});

renderGreeting();
renderFooter();
highlightActiveNav();
