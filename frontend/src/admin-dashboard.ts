import { API_BASE_URL, getSession, parseError, Trip } from "./config.js";

const { token, user } = getSession();

if (!token || !user || user.role !== "admin") {
  window.location.href = "./auth.html";
}

const authHeaders = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

type StatsPayload = {
  totalTrips?: unknown;
  totalBookings?: unknown;
  paidBookings?: unknown;
  unpaidBookings?: unknown;
  definedTripBookings?: unknown;
  plannedTripBookings?: unknown;
  monthBookings?: unknown;
  currentMonth?: unknown;
};

let confirmationChart: { destroy: () => void } | null = null;
let tripTypeBarChart: { destroy: () => void } | null = null;

let lastBookingSearch = "";

function getChartCtor():
  | (new (ctx: HTMLCanvasElement, cfg: unknown) => { destroy: () => void })
  | undefined {
  return (window as unknown as { Chart?: unknown }).Chart as
    | (new (ctx: HTMLCanvasElement, cfg: unknown) => { destroy: () => void })
    | undefined;
}

function bookingIsPaid(booking: Record<string, unknown>): boolean {
  return booking.payment === "paid";
}

function paymentBadgeClass(booking: Record<string, unknown>): string {
  return bookingIsPaid(booking) ? "badge-paid" : "badge-unpaid";
}

function paymentBadgeText(booking: Record<string, unknown>): string {
  return bookingIsPaid(booking) ? "Paid" : "Unpaid";
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TAB_COPY: Record<string, readonly [string, string]> = {
  "stats-tab": ["Overview", "Payment confirmation overview and catalogue."],
  "bookings-tab": ["Booking details", "Search and review every reservation."],
  "trips-tab": ["Add trip", "Publish a new packaged adventure to the catalogue."],
};

function setActiveTab(tabId: string): void {
  document.querySelectorAll(".sidebar-nav-btn").forEach((b) => {
    b.classList.toggle("active", (b as HTMLElement).dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-content").forEach((c) => {
    c.classList.toggle("active", c.id === tabId);
  });
  const copy = TAB_COPY[tabId];
  const titleEl = document.getElementById("adminPageTitle");
  const subEl = document.getElementById("adminPageSubtitle");
  if (copy && titleEl && subEl) {
    titleEl.textContent = copy[0];
    subEl.textContent = copy[1];
  }
}

document.querySelectorAll(".sidebar-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabId = (btn as HTMLElement).dataset.tab;
    if (tabId) setActiveTab(tabId);
  });
});

(document.getElementById("logoutBtn") as HTMLButtonElement).addEventListener("click", () => {
  localStorage.removeItem("wb_token");
  localStorage.removeItem("wb_user");
  window.location.href = "./index.html";
});

async function fetchJson(url: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

function renderConfirmationDonut(data: StatsPayload): void {
  const ChartCtor = getChartCtor();
  const canvas = document.getElementById("statsConfirmationDonut") as HTMLCanvasElement | null;
  if (!ChartCtor || !canvas) return;

  const paid = Number(data.paidBookings) || 0;
  const unpaid =
    data.unpaidBookings !== undefined && data.unpaidBookings !== null
      ? Number(data.unpaidBookings)
      : Math.max(0, Number(data.totalBookings) - paid);

  if (confirmationChart) {
    confirmationChart.destroy();
    confirmationChart = null;
  }

  const labels = ["Paid (confirmed)", "Unpaid (pending)"];
  const values = [paid, unpaid];
  let colors = ["#0f766e", "#cbd5e1"];
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    labels.length = 0;
    values.length = 0;
    labels.push("No bookings");
    values.push(1);
    colors.length = 0;
    colors.push("#e2e8f0");
  }

  confirmationChart = new ChartCtor(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#ffffff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            padding: 14,
            usePointStyle: true,
            font: { size: 11, family: "system-ui, sans-serif" },
          },
        },
      },
    },
  });
}

function renderTripTypeBar(data: StatsPayload): void {
  const ChartCtor = getChartCtor();
  const canvas = document.getElementById("statsTripTypeBar") as HTMLCanvasElement | null;
  if (!ChartCtor || !canvas) return;

  const defined = Number(data.definedTripBookings) || 0;
  const planned = Number(data.plannedTripBookings) || 0;

  if (tripTypeBarChart) {
    tripTypeBarChart.destroy();
    tripTypeBarChart = null;
  }

  tripTypeBarChart = new ChartCtor(canvas, {
    type: "bar",
    data: {
      labels: ["Defined trips", "Planned trips"],
      datasets: [
        {
          label: "Bookings",
          data: [defined, planned],
          backgroundColor: ["#0f766e", "#ea580c"],
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

function renderStatsCharts(data: StatsPayload): void {
  renderConfirmationDonut(data);
  renderTripTypeBar(data);
}

async function loadStats(): Promise<void> {
  const grid = document.getElementById("statsGrid") as HTMLElement;
  try {
    const data = (await fetchJson(`${API_BASE_URL}/admin/stats`)) as StatsPayload;
    const html = `
      <div class="stat-card">
        <h3>${data.totalTrips}</h3>
        <p>Trips in catalogue</p>
      </div>
      <div class="stat-card">
        <h3>${data.totalBookings}</h3>
        <p>Total bookings</p>
      </div>
      <div class="stat-card">
        <h3>${data.paidBookings ?? 0}</h3>
        <p>Paid / confirmed</p>
      </div>
      <div class="stat-card">
        <h3>${data.unpaidBookings ?? 0}</h3>
        <p>Unpaid / pending</p>
      </div>
      <div class="stat-card">
        <h3>${data.monthBookings}</h3>
        <p>Bookings this month</p>
      </div>
      <div class="stat-card period">
        <h3>${escapeHtml(String(data.currentMonth ?? "—"))}</h3>
        <p>Reporting period</p>
      </div>
    `;
    grid.innerHTML = html;
    renderStatsCharts(data);
  } catch (error) {
    grid.innerHTML = `<p class="error-text">${escapeHtml(
      error instanceof Error ? error.message : "Failed to load stats"
    )}</p>`;
  }
}

async function fetchBookings(search = ""): Promise<Array<Record<string, unknown>>> {
  const data = await fetchJson(`${API_BASE_URL}/admin/bookings?search=${encodeURIComponent(search)}`);
  return (data.bookings || []) as Array<Record<string, unknown>>;
}

function renderRecentBookings(bookings: Array<Record<string, unknown>>): void {
  const el = document.getElementById("recentBookingsList") as HTMLElement;
  if (!bookings.length) {
    el.innerHTML = '<p class="empty-hint">No bookings yet.</p>';
    return;
  }
  const sorted = [...bookings].sort((a, b) => {
    const ta = new Date(String(a.createdAt ?? 0)).getTime();
    const tb = new Date(String(b.createdAt ?? 0)).getTime();
    return tb - ta;
  });

  const slice = sorted.slice(0, 10);
  el.innerHTML = slice
    .map((booking) => {
      const isDefined = booking.tripType === "defined_trip";
      const badgeClass = isDefined ? "badge-defined" : "badge-planned";
      const badgeText = isDefined ? "Defined" : "Planned";
      const dest = escapeHtml(String(booking.travelDestination ?? ""));
      const name = escapeHtml(String(booking.fullName ?? ""));
      const mobile = escapeHtml(String(booking.mobile ?? ""));
      return `
        <div class="recent-booking-row">
          <div>
            <strong>${dest}</strong>
            <span class="meta">${name} · ${mobile}</span>
          </div>
          <div class="meta">${new Date(String(booking.dateOfTravel ?? "")).toLocaleDateString()}</div>
          <div><span class="badge ${badgeClass}">${badgeText}</span> <span class="badge ${paymentBadgeClass(booking)}">${paymentBadgeText(booking)}</span></div>
        </div>
      `;
    })
    .join("");
}

function renderBookingList(bookings: Array<Record<string, unknown>>): void {
  const listEl = document.getElementById("bookingList") as HTMLElement;
  if (!bookings.length) {
    listEl.innerHTML = '<p class="empty-hint" style="text-align:center;">No bookings found.</p>';
    return;
  }

  const html = bookings
    .map((booking) => {
      const id = escapeHtml(String(booking._id ?? ""));
      const paid = bookingIsPaid(booking);
      const confirmBtn = paid
        ? `<span class="booking-confirmed-label">Confirmed</span>`
        : `<button type="button" class="btn-confirm-booking" data-confirm-booking="${id}">Confirm payment</button>`;
      return `
        <div class="booking-item">
          <div>
            <h4>${escapeHtml(String(booking.travelDestination ?? ""))}</h4>
            <div class="booking-detail"><strong>Name:</strong> ${escapeHtml(String(booking.fullName ?? ""))}</div>
            <div class="booking-detail"><strong>Type:</strong> ${
              booking.tripType === "defined_trip" ? "Defined trip" : "Planned trip"
            }</div>
            <div class="booking-detail"><strong>Payment:</strong> <span class="badge ${paymentBadgeClass(booking)}">${paymentBadgeText(
              booking
            )}</span></div>
          </div>
          <div>
            <div class="booking-detail"><strong>Mobile:</strong> ${escapeHtml(String(booking.mobile ?? ""))}</div>
            <div class="booking-detail"><strong>Email:</strong> ${escapeHtml(String(booking.email ?? "N/A"))}</div>
            <div class="booking-detail"><strong>People:</strong> ${escapeHtml(String(booking.numberOfPeople ?? ""))}</div>
          </div>
          <div>
            <div class="booking-detail"><strong>Travel date:</strong> ${new Date(
              String(booking.dateOfTravel ?? "")
            ).toLocaleDateString()}</div>
            <div class="booking-detail"><strong>Booked on:</strong> ${new Date(
              String(booking.createdAt ?? "")
            ).toLocaleDateString()}</div>
          </div>
          <div class="booking-item-actions">${confirmBtn}</div>
        </div>
      `;
    })
    .join("");

  listEl.innerHTML = html;
}

async function loadTrips(search = ""): Promise<void> {
  try {
    const data = await fetchJson(`${API_BASE_URL}/admin/trips?search=${encodeURIComponent(search)}`);
    const trips = (data.trips || []) as Trip[];

    if (trips.length === 0) {
      (document.getElementById("tripScrollContainer") as HTMLElement).innerHTML =
        '<p class="empty-hint">No trips found.</p>';
      return;
    }

    const html = trips
      .map(
        (trip) => `
        <div class="trip-card-scroll">
          <img src="${trip.imageUrl || "./assets/lake.jpg"}" alt="${escapeHtml(trip.title)}">
          <div class="trip-card-info">
            <h4>${escapeHtml(trip.title)}</h4>
            <p>${escapeHtml(trip.location)}</p>
            <p>${escapeHtml(trip.durationLabel)} · ₹${Number(trip.price).toLocaleString("en-IN")}</p>
            <p style="margin-top:8px;font-size:12px;">${new Date(trip.startDate).toLocaleDateString()}</p>
          </div>
        </div>
      `
      )
      .join("");

    (document.getElementById("tripScrollContainer") as HTMLElement).innerHTML = html;
  } catch (error) {
    (document.getElementById("tripScrollContainer") as HTMLElement).innerHTML = `<p class="error-text">${
      error instanceof Error ? error.message : "Failed to load trips"
    }</p>`;
  }
}

(document.getElementById("tripSearchBtn") as HTMLButtonElement).addEventListener("click", () => {
  const search = (document.getElementById("tripSearchInput") as HTMLInputElement).value.trim();
  loadTrips(search);
});

(document.getElementById("tripSearchInput") as HTMLInputElement).addEventListener("keyup", (e) => {
  if (e.key === "Enter") {
    (document.getElementById("tripSearchBtn") as HTMLButtonElement).click();
  }
});

(document.getElementById("bookingSearchBtn") as HTMLButtonElement).addEventListener("click", async () => {
  const search = (document.getElementById("bookingSearchInput") as HTMLInputElement).value.trim();
  lastBookingSearch = search;
  try {
    const bookings = await fetchBookings(search);
    renderBookingList(bookings);
  } catch (error) {
    (document.getElementById("bookingList") as HTMLElement).innerHTML = `<p class="error-text">${
      error instanceof Error ? error.message : "Failed to load bookings"
    }</p>`;
  }
});

(document.getElementById("bookingSearchInput") as HTMLInputElement).addEventListener("keyup", (e) => {
  if (e.key === "Enter") {
    (document.getElementById("bookingSearchBtn") as HTMLButtonElement).click();
  }
});

(document.getElementById("tripForm") as HTMLFormElement).addEventListener("submit", async (event) => {
  event.preventDefault();

  const statusEl = document.getElementById("tripFormStatus") as HTMLElement;
  statusEl.textContent = "Adding trip…";
  statusEl.className = "";

  try {
    const payload = {
      title: (document.getElementById("tripTitle") as HTMLInputElement).value.trim(),
      location: (document.getElementById("tripLocation") as HTMLInputElement).value.trim(),
      duration_label: (document.getElementById("tripDuration") as HTMLInputElement).value.trim(),
      price: Number((document.getElementById("tripPrice") as HTMLInputElement).value),
      start_date: (document.getElementById("tripStartDate") as HTMLInputElement).value,
      end_date: (document.getElementById("tripEndDate") as HTMLInputElement).value,
      image_name: (document.getElementById("tripImageName") as HTMLInputElement).value.trim(),
      published: true,
    };

    const response = await fetch(`${API_BASE_URL}/admin/trips`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(await parseError(response));

    statusEl.textContent = "Trip added successfully.";
    statusEl.className = "status-message success";
    (event.target as HTMLFormElement).reset();
    await loadStats();
    await loadTrips();
    lastBookingSearch = "";
    const bookings = await fetchBookings("");
    renderBookingList(bookings);
    renderRecentBookings(bookings);
  } catch (error) {
    statusEl.textContent = (error instanceof Error ? error.message : "Failed to add trip") || "Error";
    statusEl.className = "status-message error";
  }
});

(document.getElementById("bookingList") as HTMLElement).addEventListener("click", async (e) => {
  const trigger = (e.target as HTMLElement).closest("[data-confirm-booking]");
  if (!trigger || !(trigger instanceof HTMLButtonElement)) return;
  const id = trigger.getAttribute("data-confirm-booking");
  if (!id || trigger.disabled) return;
  trigger.disabled = true;
  try {
    await fetchJson(`${API_BASE_URL}/admin/bookings/confirm-payment`, {
      method: "POST",
      body: JSON.stringify({ booking_id: id }),
    });
    await loadStats();
    const bookings = await fetchBookings(lastBookingSearch);
    renderBookingList(bookings);
    if (lastBookingSearch === "") {
      renderRecentBookings(bookings);
    }
  } catch (err) {
    window.alert(err instanceof Error ? err.message : "Could not confirm booking");
    trigger.disabled = false;
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadStats();
  try {
    lastBookingSearch = "";
    const bookings = await fetchBookings("");
    renderBookingList(bookings);
    renderRecentBookings(bookings);
  } catch (error) {
    (document.getElementById("bookingList") as HTMLElement).innerHTML = `<p class="error-text">${
      error instanceof Error ? error.message : "Failed to load bookings"
    }</p>`;
    (document.getElementById("recentBookingsList") as HTMLElement).innerHTML =
      '<p class="empty-hint">Could not load recent bookings.</p>';
  }
  await loadTrips();
});
