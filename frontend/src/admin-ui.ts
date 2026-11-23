/**
 * Admin UI niceties: toasts, count-up numbers, command palette (Ctrl/⌘ + K), collapsible sidebar,
 * button ripples, live (debounced) search, greeting.
 */

export type ToastKind = "success" | "error" | "info";

function toastHost(): HTMLElement {
  let host = document.getElementById("admToasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "admToasts";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  return host;
}

export function showToast(message: string, kind: ToastKind = "info", ms = 4200): void {
  const el = document.createElement("div");
  el.className = `adm-toast adm-toast--${kind}`;
  const icon = kind === "success" ? "✓" : kind === "error" ? "!" : "i";
  el.innerHTML = `<span class="adm-toast-ico" aria-hidden="true">${icon}</span><span class="adm-toast-msg"></span><button type="button" aria-label="Dismiss">×</button>`;
  (el.querySelector(".adm-toast-msg") as HTMLElement).textContent = message;
  const close = (): void => {
    el.classList.add("is-leaving");
    window.setTimeout(() => el.remove(), 260);
  };
  el.querySelector("button")?.addEventListener("click", close);
  toastHost().appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-in"));
  window.setTimeout(close, ms);
}

/** Drop-in replacement for window.alert: errors vs. info decided from the wording. */
export function adminAlert(message: string): void {
  const bad = /fail|error|could not|couldn't|invalid|must|cannot|can't|unable|not found|denied|required|at least/i.test(message);
  showToast(message, bad ? "error" : "info", bad ? 6000 : 4200);
}

/** Animate every [data-count] inside root from 0 to its value. */
export function animateCounts(root: ParentNode = document): void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count ?? 0);
    if (reduce || !Number.isFinite(target) || target === 0) {
      el.textContent = Number.isFinite(target) ? target.toLocaleString("en-IN") : "—";
      return;
    }
    const t0 = performance.now();
    const dur = 900;
    const tick = (now: number): void => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString("en-IN");
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms = 350): (...args: T) => void {
  let t = 0;
  return (...args: T) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

/** Typing in a search box triggers its Search button after a short pause. */
export function liveSearch(inputId: string, buttonId: string): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  const btn = document.getElementById(buttonId) as HTMLButtonElement | null;
  if (!input || !btn) return;
  input.addEventListener("input", debounce(() => btn.click(), 380));
}

/* ───────────── command palette ───────────── */

type Command = { label: string; hint: string; icon: string; run: () => void };

function buildCommands(goTab: (id: string) => void): Command[] {
  const clickTab = (id: string): (() => void) => () => goTab(id);
  return [
    { label: "Overview", hint: "Stats, charts, recent bookings", icon: "📊", run: clickTab("stats-tab") },
    { label: "Booking details", hint: "Search & confirm payments", icon: "🧾", run: clickTab("bookings-tab") },
    { label: "Add a catalogue trip", hint: "New upcoming trip with dates & price", icon: "➕", run: () => { goTab("trips-tab"); window.setTimeout(() => document.getElementById("tripTitle")?.focus(), 250); } },
    { label: "Travel Gallery", hint: "Places, districts and past trips", icon: "🗺️", run: clickTab("gallery-tab") },
    { label: "Add a gallery trip", hint: "Step-by-step: state → district → place → trip", icon: "📍", run: () => { goTab("gallery-tab"); window.setTimeout(() => (document.querySelector('[data-action="start-wizard"]') as HTMLElement | null)?.click(), 350); } },
    { label: "Open website", hint: "wonderbaboon.com home", icon: "🌐", run: () => window.open("/", "_blank") },
    { label: "Log out", hint: "End this admin session", icon: "🚪", run: () => document.getElementById("logoutBtn")?.click() },
  ];
}

function openPalette(goTab: (id: string) => void): void {
  if (document.getElementById("admPalette")) return;
  const commands = buildCommands(goTab);
  const wrap = document.createElement("div");
  wrap.id = "admPalette";
  wrap.innerHTML = `
    <div class="adm-pal" role="dialog" aria-modal="true" aria-label="Quick actions">
      <input type="text" class="adm-pal-input" placeholder="Jump to… (type to filter)" autocomplete="off" />
      <ul class="adm-pal-list" role="listbox"></ul>
      <p class="adm-pal-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</p>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector<HTMLInputElement>(".adm-pal-input")!;
  const list = wrap.querySelector<HTMLUListElement>(".adm-pal-list")!;
  let active = 0;
  let shown = commands;

  const close = (): void => {
    wrap.classList.add("is-leaving");
    window.setTimeout(() => wrap.remove(), 160);
    document.removeEventListener("keydown", onKey, true);
  };
  const draw = (): void => {
    list.innerHTML = shown
      .map(
        (c, i) => `<li role="option" class="${i === active ? "is-active" : ""}" data-i="${i}">
          <span class="adm-pal-ico">${c.icon}</span><span><strong>${c.label}</strong><em>${c.hint}</em></span></li>`
      )
      .join("") || `<li class="adm-pal-empty">No matches</li>`;
  };
  const run = (i: number): void => {
    const cmd = shown[i];
    if (!cmd) return;
    close();
    cmd.run();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(shown.length - 1, active + 1);
      draw();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, active - 1);
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(active);
    }
  };
  document.addEventListener("keydown", onKey, true);
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    shown = commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q));
    active = 0;
    draw();
  });
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li) run(Number(li.dataset.i));
  });
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  draw();
  requestAnimationFrame(() => {
    wrap.classList.add("is-in");
    input.focus();
  });
}

/* ───────────── init ───────────── */

export function initAdminUi(goTab: (id: string) => void, adminName: string): void {
  // greeting + today's date under the page title
  const header = document.querySelector<HTMLElement>(".admin-main-header");
  if (header && !document.getElementById("admGreeting")) {
    const hour = new Date().getHours();
    const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    header.insertAdjacentHTML(
      "beforeend",
      `<div class="adm-header-tools">
        <p id="admGreeting"><strong>${hello}${adminName ? `, ${adminName.replace(/[&<>"']/g, "")}` : ""}</strong><span>${today}</span></p>
        <button type="button" class="adm-kbd-btn" id="admPaletteBtn" aria-label="Quick actions"><span>Quick actions</span><kbd>Ctrl</kbd><kbd>K</kbd></button>
      </div>`
    );
  }
  document.getElementById("admPaletteBtn")?.addEventListener("click", () => openPalette(goTab));

  // collapsible sidebar (remembered) + mobile drawer
  const layout = document.querySelector<HTMLElement>(".admin-layout");
  const brand = document.querySelector<HTMLElement>(".admin-brand");
  try {
    if (localStorage.getItem("wb_adm_collapsed") === "1") layout?.classList.add("is-collapsed");
  } catch {
    /* storage unavailable */
  }
  if (brand && !document.getElementById("admCollapse")) {
    brand.insertAdjacentHTML("beforeend", `<button type="button" id="admCollapse" class="adm-collapse" aria-label="Collapse sidebar" title="Collapse sidebar">‹</button>`);
    document.getElementById("admCollapse")?.addEventListener("click", () => {
      const on = layout?.classList.toggle("is-collapsed");
      try {
        localStorage.setItem("wb_adm_collapsed", on ? "1" : "0");
      } catch {
        /* ignore */
      }
    });
  }
  if (!document.getElementById("admMenuBtn")) {
    document.body.insertAdjacentHTML("beforeend", `<button type="button" id="admMenuBtn" class="adm-menu-btn" aria-label="Open menu"><span></span><span></span><span></span></button><div id="admScrim" class="adm-scrim"></div>`);
    const toggle = (open: boolean): void => {
      layout?.classList.toggle("is-drawer-open", open);
    };
    document.getElementById("admMenuBtn")?.addEventListener("click", () => toggle(true));
    document.getElementById("admScrim")?.addEventListener("click", () => toggle(false));
    document.querySelectorAll(".sidebar-nav-btn").forEach((b) => b.addEventListener("click", () => toggle(false)));
  }

  // shortcuts: Ctrl/⌘+K palette, "/" focuses the visible search box
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette(goTab);
      return;
    }
    const t = e.target as HTMLElement;
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) {
      const box = document.querySelector<HTMLInputElement>(".tab-content.active .search-bar input");
      if (box) {
        e.preventDefault();
        box.focus();
      }
    }
  });

  // ripple on buttons
  document.addEventListener("pointerdown", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("button, .form-submit, .btn-primary, .btn-second");
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const rect = btn.getBoundingClientRect();
    const dot = document.createElement("span");
    dot.className = "adm-ripple";
    const size = Math.max(rect.width, rect.height);
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
    if (getComputedStyle(btn).position === "static") btn.style.position = "relative";
    btn.style.overflow = btn.style.overflow || "hidden";
    btn.appendChild(dot);
    window.setTimeout(() => dot.remove(), 600);
  });

  liveSearch("bookingSearchInput", "bookingSearchBtn");
  liveSearch("tripSearchInput", "tripSearchBtn");
  liveSearch("adminTripManageSearch", "adminTripManageSearchBtn");
}
