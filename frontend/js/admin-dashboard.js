import { API_BASE_URL, getSession, parseError, ROUTES } from "./config.js";
import { normalizeTripStyle, TRIP_STYLE_ORDER, TRIP_STYLES } from "./trip-styles.js";
const { token, user } = getSession();
if (!token || !user || user.role !== "admin") {
    window.location.href = ROUTES.auth;
}
const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
};
let confirmationChart = null;
let tripTypeBarChart = null;
let lastBookingSearch = "";
function getChartCtor() {
    return window.Chart;
}
function effectivePaymentStatus(booking) {
    const raw = String(booking.payment ?? "unpaid");
    const balance = Number(booking.balanceDueInr ?? 0);
    if (raw === "paid" && balance > 0)
        return "advance_paid";
    if (raw === "advance_paid" && balance <= 0 && Number(booking.packageTotalInr ?? 0) > 0)
        return "paid";
    return raw;
}
function bookingIsFullyPaid(booking) {
    return effectivePaymentStatus(booking) === "paid";
}
function bookingIsAdvancePaid(booking) {
    return effectivePaymentStatus(booking) === "advance_paid";
}
function bookingHasPaymentRecorded(booking) {
    return bookingIsFullyPaid(booking) || bookingIsAdvancePaid(booking);
}
function paymentBadgeClass(booking) {
    if (bookingIsFullyPaid(booking))
        return "badge-paid";
    if (bookingIsAdvancePaid(booking))
        return "badge-advance";
    return "badge-unpaid";
}
function paymentBadgeText(booking) {
    if (bookingIsFullyPaid(booking))
        return "Paid";
    if (bookingIsAdvancePaid(booking))
        return "Advance paid";
    return "Unpaid";
}
function bookingPaymentBreakdownHtml(booking) {
    if (!bookingHasPaymentRecorded(booking) || booking.packageTotalInr == null)
        return "";
    return `
    <div class="booking-pay-history">
      <span>Total ₹${Number(booking.packageTotalInr).toLocaleString("en-IN")}</span>
      ·
      <span>Advance ₹${Number(booking.advancePaymentInr ?? 0).toLocaleString("en-IN")}</span>
      ·
      <span>Balance ₹${Number(booking.balanceDueInr ?? 0).toLocaleString("en-IN")}</span>
    </div>`;
}
/** Whole rupees; empty field → undefined */
function parseRupeeField(raw) {
    const trimmed = raw.replace(/,/g, "").trim();
    if (trimmed === "")
        return undefined;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0)
        return undefined;
    return n;
}
function syncBookingConfirmPanel(panel) {
    const btn = panel.querySelector("[data-confirm-booking]");
    const advanceEl = panel.querySelector("[data-advance-inr]");
    if (!(btn instanceof HTMLButtonElement) || !advanceEl)
        return;
    const hasCatalogTotal = panel.getAttribute("data-has-catalog-total") === "1";
    const catalogAttr = Number(panel.getAttribute("data-catalog-total") ?? "");
    const catalogTotal = Number.isFinite(catalogAttr) && catalogAttr >= 1 ? Math.floor(catalogAttr) : undefined;
    let packageTotal = hasCatalogTotal && catalogTotal !== undefined ? catalogTotal : undefined;
    if (!hasCatalogTotal || catalogTotal === undefined) {
        const tripEl = panel.querySelector("[data-trip-total]");
        packageTotal = tripEl ? parseRupeeField(tripEl.value) : undefined;
    }
    const advance = parseRupeeField(advanceEl.value);
    const preview = panel.querySelector("[data-balance-preview]");
    if (preview) {
        if (packageTotal !== undefined && advance !== undefined) {
            const bal = packageTotal - advance;
            preview.textContent =
                bal >= 0 ? `Balance due: ₹${bal.toLocaleString("en-IN")}` : "Advance exceeds package total";
        }
        else {
            preview.textContent = "Balance due: —";
        }
    }
    const valid = packageTotal !== undefined &&
        packageTotal >= 1 &&
        advance !== undefined &&
        advance >= 1 &&
        advance <= packageTotal;
    btn.disabled = !valid;
    btn.textContent =
        packageTotal !== undefined && advance !== undefined && advance >= packageTotal
            ? "Record full payment"
            : "Record advance";
}
function escapeHtml(raw) {
    return raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function bookingTravelersSummary(booking) {
    const t = booking.travelers;
    if (Array.isArray(t) && t.length) {
        return t.map((x) => String(x)).join(" · ");
    }
    const parts = [];
    if (booking.fullName)
        parts.push(String(booking.fullName));
    for (let i = 2; i <= 20; i++) {
        const v = booking[`traveler${i}`];
        if (v)
            parts.push(String(v));
    }
    return parts.join(" · ");
}
let lastTripManageSearch = "";
let lastTripManageRows = [];
function tripStyleLabel(raw) {
    return TRIP_STYLES[normalizeTripStyle(raw)].shortLabel;
}
function tripStyleSelectOptions(selected) {
    const sel = normalizeTripStyle(selected);
    return TRIP_STYLE_ORDER.map((slug) => {
        const cfg = TRIP_STYLES[slug];
        return `<option value="${slug}" ${slug === sel ? "selected" : ""}>${cfg.title}</option>`;
    })
        .join("");
}
function imageBasenameFromTripUrl(url) {
    if (!url)
        return "";
    const parts = url.split("/");
    return parts[parts.length - 1] || "";
}
async function uploadTripItineraryPdf(tripId, file) {
    const fd = new FormData();
    fd.append("file", file);
    const response = await fetch(`${API_BASE_URL}/admin/trips/${encodeURIComponent(tripId)}/itinerary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
    });
    if (!response.ok)
        throw new Error(await parseError(response));
}
async function clearTripItineraryPdf(tripId) {
    const response = await fetch(`${API_BASE_URL}/admin/trips/${encodeURIComponent(tripId)}/itinerary`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok)
        throw new Error(await parseError(response));
}
async function deleteTripById(tripId) {
    const response = await fetch(`${API_BASE_URL}/admin/trips/${encodeURIComponent(tripId)}`, {
        method: "DELETE",
        headers: authHeaders,
    });
    if (!response.ok)
        throw new Error(await parseError(response));
}
async function deleteBookingById(bookingId) {
    const response = await fetch(`${API_BASE_URL}/admin/bookings/${encodeURIComponent(bookingId)}`, {
        method: "DELETE",
        headers: authHeaders,
    });
    if (!response.ok)
        throw new Error(await parseError(response));
}
async function addBookingMembers(bookingId, additionalTravelers) {
    const response = await fetch(`${API_BASE_URL}/admin/bookings/${encodeURIComponent(bookingId)}/members`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ additional_travelers: additionalTravelers }),
    });
    if (!response.ok)
        throw new Error(await parseError(response));
}
function openAddMembersModal(booking) {
    const id = String(booking._id ?? "");
    const current = Number(booking.numberOfPeople ?? 1);
    const maxAdd = Math.max(0, 20 - current);
    if (maxAdd <= 0) {
        window.alert("This booking already has the maximum of 20 travelers.");
        return;
    }
    document.getElementById("bookingMembersModal")?.remove();
    const wrap = document.createElement("div");
    wrap.id = "bookingMembersModal";
    wrap.className = "admin-modal-overlay";
    wrap.innerHTML = `
    <div class="admin-modal" role="dialog" aria-modal="true">
      <h3>Add travelers</h3>
      <p class="form-hint">Current headcount: ${current}. Add up to ${maxAdd} more.</p>
      <form id="bookingMembersForm" class="admin-modal-form">
        <label>How many to add?<input name="count" type="number" min="1" max="${maxAdd}" value="1" required /></label>
        <div id="bookingMembersNames"></div>
        <div class="admin-modal-actions">
          <button type="button" class="btn-cancel" id="bookingMembersCancel">Cancel</button>
          <button type="submit" class="form-submit" id="bookingMembersSubmit">Save & notify</button>
        </div>
      </form>
    </div>`;
    document.body.appendChild(wrap);
    const namesEl = wrap.querySelector("#bookingMembersNames");
    const countEl = wrap.querySelector('input[name="count"]');
    const syncNames = () => {
        if (!namesEl || !countEl)
            return;
        const n = Math.min(maxAdd, Math.max(1, Number(countEl.value) || 1));
        namesEl.innerHTML = Array.from({ length: n }, (_, i) => {
            const num = current + i + 1;
            return `<label>Traveler ${num} full name<input type="text" class="member-name-input" required minlength="2" /></label>`;
        }).join("");
    };
    syncNames();
    countEl?.addEventListener("input", syncNames);
    const close = () => wrap.remove();
    wrap.querySelector("#bookingMembersCancel")?.addEventListener("click", close);
    wrap.addEventListener("click", (e) => {
        if (e.target === wrap)
            close();
    });
    wrap.querySelector("#bookingMembersForm")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const submitBtn = wrap.querySelector("#bookingMembersSubmit");
        const names = Array.from(wrap.querySelectorAll(".member-name-input")).map((el) => el.value.trim());
        if (names.some((n) => n.length < 2)) {
            window.alert("Each name must be at least 2 characters.");
            return;
        }
        const prevLabel = submitBtn?.textContent || "Save & notify";
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Sending…";
        }
        try {
            await addBookingMembers(id, names);
            close();
            const [, bookings] = await Promise.all([loadStats(), fetchBookings(lastBookingSearch)]);
            renderBookingList(bookings);
        }
        catch (err) {
            window.alert(err instanceof Error ? err.message : "Could not add travelers");
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = prevLabel;
            }
        }
    });
}
async function patchTrip(tripId, body) {
    const response = await fetch(`${API_BASE_URL}/admin/trips/${encodeURIComponent(tripId)}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify(body),
    });
    if (!response.ok)
        throw new Error(await parseError(response));
}
function renderTripManageList(trips) {
    const el = document.getElementById("tripManageList");
    if (!el)
        return;
    if (!trips.length) {
        el.innerHTML = '<p class="empty-hint">No trips match this filter.</p>';
        return;
    }
    el.innerHTML = trips
        .map((trip) => {
        const id = escapeHtml(String(trip._id));
        const hasItin = Boolean((trip.itineraryHtml || "").trim().length);
        const pub = trip.published !== false;
        const styleLabel = tripStyleLabel(trip.tripStyle);
        return `
    <div class="trip-manage-row" data-trip-row="${id}">
      <div class="trip-manage-main">
        <strong>${escapeHtml(trip.title)}</strong>
        <span class="trip-manage-meta">${escapeHtml(trip.location)} · ${escapeHtml(trip.durationLabel)} · ₹${Number(trip.price).toLocaleString("en-IN")}</span>
        <span class="trip-manage-badges">
          <span class="badge-itin badge-style">${escapeHtml(styleLabel)}</span>
          <span class="badge-itin ${hasItin ? "badge-itin--yes" : "badge-itin--no"}">${hasItin ? "PDF itinerary" : "No itinerary"}</span>
          <span class="badge-itin ${pub ? "badge-pub--yes" : "badge-pub--no"}">${pub ? "Published" : "Hidden"}</span>
        </span>
      </div>
      <div class="trip-manage-actions">
        <button type="button" class="btn-second" data-edit-trip="${id}">Edit</button>
        <label class="btn-second btn-file-label">
          PDF
          <input type="file" accept="application/pdf,.pdf" class="trip-itin-file" data-upload-itin="${id}" />
        </label>
        <button type="button" class="btn-second" data-clear-itin="${id}" ${hasItin ? "" : "disabled"}>Clear PDF</button>
        <button type="button" class="btn-danger-outline" data-delete-trip="${id}">Delete</button>
      </div>
    </div>`;
    })
        .join("");
}
async function loadTripManageList(search = "") {
    const el = document.getElementById("tripManageList");
    if (!el)
        return;
    lastTripManageSearch = search;
    el.innerHTML = '<p class="empty-hint">Loading…</p>';
    try {
        const data = await fetchJson(`${API_BASE_URL}/admin/trips?search=${encodeURIComponent(search)}`);
        const trips = (data.trips || []);
        lastTripManageRows = trips;
        renderTripManageList(trips);
    }
    catch (error) {
        el.innerHTML = `<p class="error-text">${escapeHtml(error instanceof Error ? error.message : "Failed to load trips")}</p>`;
    }
}
function openEditTripModal(trip) {
    document.getElementById("tripEditModal")?.remove();
    const id = String(trip._id);
    const imageFile = imageBasenameFromTripUrl(trip.imageUrl);
    const wrap = document.createElement("div");
    wrap.id = "tripEditModal";
    wrap.className = "admin-modal-overlay";
    wrap.innerHTML = `
    <div class="admin-modal" role="dialog" aria-modal="true">
      <h3>Edit trip</h3>
      <form id="tripEditForm" class="admin-modal-form">
        <label>Title<input name="title" required value="${escapeHtml(trip.title)}" /></label>
        <label>Location<input name="location" required value="${escapeHtml(trip.location)}" /></label>
        <label>Duration<input name="duration_label" required value="${escapeHtml(trip.durationLabel)}" /></label>
        <label>Price (₹)<input name="price" type="number" min="0" required value="${Number(trip.price)}" /></label>
        <label>Start date<input name="start_date" type="date" required value="${escapeHtml(String(trip.startDate || "").slice(0, 10))}" /></label>
        <label>End date<input name="end_date" type="date" required value="${escapeHtml(String((trip.endDate || trip.startDate) || "").slice(0, 10))}" /></label>
        <label>Trip style<select name="trip_style" required>${tripStyleSelectOptions(trip.tripStyle)}</select></label>
        <label>Image file in assets/<input name="image_name" required value="${escapeHtml(imageFile)}" /></label>
        <label class="checkbox-row"><input name="published" type="checkbox" ${trip.published !== false ? "checked" : ""} /> Published (show on website)</label>
        <div class="admin-modal-actions">
          <button type="button" class="btn-cancel" id="tripEditCancel">Cancel</button>
          <button type="submit" class="form-submit" id="tripEditSave">Save</button>
        </div>
      </form>
    </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector("#tripEditCancel")?.addEventListener("click", close);
    wrap.addEventListener("click", (e) => {
        if (e.target === wrap)
            close();
    });
    wrap.querySelector("#tripEditForm")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const fd = new FormData(f);
        const body = {
            title: String(fd.get("title") || "").trim(),
            location: String(fd.get("location") || "").trim(),
            duration_label: String(fd.get("duration_label") || "").trim(),
            price: Number(fd.get("price")),
            start_date: String(fd.get("start_date") || ""),
            end_date: String(fd.get("end_date") || ""),
            image_name: String(fd.get("image_name") || "").trim(),
            published: fd.get("published") === "on",
            trip_style: String(fd.get("trip_style") || "backpackers"),
        };
        const saveBtn = wrap.querySelector("#tripEditSave");
        saveBtn.disabled = true;
        try {
            await patchTrip(id, body);
            close();
            await loadTripManageList(lastTripManageSearch);
            await loadTrips(document.getElementById("tripSearchInput")?.value?.trim() || "");
        }
        catch (err) {
            window.alert(err instanceof Error ? err.message : "Save failed");
        }
        finally {
            saveBtn.disabled = false;
        }
    });
}
const TAB_COPY = {
    "stats-tab": ["Overview", "Payment confirmation overview and catalogue."],
    "bookings-tab": ["Booking details", "Search and review every reservation."],
    "trips-tab": ["Trips", "Add packages, upload PDF itineraries, edit or remove catalogue trips."],
};
function setActiveTab(tabId) {
    document.querySelectorAll(".sidebar-nav-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === tabId);
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
    if (tabId === "trips-tab")
        void loadTripManageList(lastTripManageSearch);
}
document.querySelectorAll(".sidebar-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const tabId = btn.dataset.tab;
        if (tabId)
            setActiveTab(tabId);
    });
});
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("wb_token");
    localStorage.removeItem("wb_user");
    window.location.href = ROUTES.home;
});
async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...authHeaders,
            ...options.headers,
        },
    });
    if (!response.ok) {
        throw new Error(await parseError(response));
    }
    return response.json();
}
function renderConfirmationDonut(data) {
    const ChartCtor = getChartCtor();
    const canvas = document.getElementById("statsConfirmationDonut");
    if (!ChartCtor || !canvas)
        return;
    const paid = Number(data.paidBookings) || 0;
    const advancePaid = Number(data.advancePaidBookings) || 0;
    const unpaid = data.unpaidBookings !== undefined && data.unpaidBookings !== null
        ? Number(data.unpaidBookings)
        : Math.max(0, Number(data.totalBookings) - paid - advancePaid);
    if (confirmationChart) {
        confirmationChart.destroy();
        confirmationChart = null;
    }
    const labels = ["Fully paid", "Advance paid", "Unpaid (pending)"];
    const values = [paid, advancePaid, unpaid];
    let colors = ["#0f766e", "#2563eb", "#cbd5e1"];
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
function renderTripTypeBar(data) {
    const ChartCtor = getChartCtor();
    const canvas = document.getElementById("statsTripTypeBar");
    if (!ChartCtor || !canvas)
        return;
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
function renderStatsCharts(data) {
    renderConfirmationDonut(data);
    renderTripTypeBar(data);
}
async function loadStats() {
    const grid = document.getElementById("statsGrid");
    try {
        const data = (await fetchJson(`${API_BASE_URL}/admin/stats`));
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
        <p>Fully paid</p>
      </div>
      <div class="stat-card">
        <h3>${data.advancePaidBookings ?? 0}</h3>
        <p>Advance paid</p>
      </div>
      <div class="stat-card">
        <h3>${data.unpaidBookings ?? 0}</h3>
        <p>Unpaid / pending</p>
      </div>
      <div class="stat-card">
        <h3>${data.monthBookings}</h3>
        <p>Bookings this month</p>
      </div>
    `;
        grid.innerHTML = html;
        renderStatsCharts(data);
    }
    catch (error) {
        grid.innerHTML = `<p class="error-text">${escapeHtml(error instanceof Error ? error.message : "Failed to load stats")}</p>`;
    }
}
async function fetchBookings(search = "") {
    const data = await fetchJson(`${API_BASE_URL}/admin/bookings?search=${encodeURIComponent(search)}`);
    return (data.bookings || []);
}
function renderRecentBookings(bookings) {
    const el = document.getElementById("recentBookingsList");
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
        const travelers = escapeHtml(bookingTravelersSummary(booking));
        const mobile = escapeHtml(String(booking.mobile ?? ""));
        return `
        <div class="recent-booking-row">
          <div>
            <strong>${dest}</strong>
            <span class="meta">${travelers || name} · ${mobile}</span>
          </div>
          <div class="meta">${new Date(String(booking.dateOfTravel ?? "")).toLocaleDateString()}</div>
          <div><span class="badge ${badgeClass}">${badgeText}</span> <span class="badge ${paymentBadgeClass(booking)}">${paymentBadgeText(booking)}</span></div>
        </div>
      `;
    })
        .join("");
}
function renderBookingList(bookings) {
    const listEl = document.getElementById("bookingList");
    if (!bookings.length) {
        listEl.innerHTML = '<p class="empty-hint" style="text-align:center;">No bookings found.</p>';
        return;
    }
    const html = bookings
        .map((booking) => {
        const id = escapeHtml(String(booking._id ?? ""));
        const fullyPaid = bookingIsFullyPaid(booking);
        const advancePaid = bookingIsAdvancePaid(booking);
        const breakdown = bookingPaymentBreakdownHtml(booking);
        let confirmBlock = "";
        if (fullyPaid) {
            confirmBlock = `<span class="booking-confirmed-label">Fully paid</span>${breakdown}`;
        }
        else if (advancePaid) {
            confirmBlock = `
          <span class="booking-confirmed-label booking-confirmed-label--advance">Advance received</span>
          ${breakdown}
          <button type="button" class="btn-mark-full-payment" data-mark-full-payment="${id}">
            Mark full payment received
          </button>`;
        }
        else {
            const typed = booking;
            const catalogRaw = typed.computedPackageTotalInr;
            const catalogNum = catalogRaw != null && catalogRaw !== "" ? Math.floor(Number(catalogRaw)) : NaN;
            const defined = booking.tripType === "defined_trip";
            const useCatalogPrice = defined && Number.isFinite(catalogNum) && catalogNum >= 1;
            const totalRow = useCatalogPrice
                ? `
            <p class="booking-pkg-fixed">Catalogue total (${escapeHtml(String(booking.numberOfPeople ?? 1))} × per-person)</p>
            <p class="booking-pkg-amount"><strong>₹${catalogNum.toLocaleString("en-IN")}</strong></p>`
                : `
            <label class="booking-pay-field-label">Quoted package total (₹)<input type="number" inputmode="numeric" min="1" step="1" class="booking-pay-field" placeholder="Enter total due" data-trip-total /></label>`;
            confirmBlock = `
          <div
            class="booking-pay-panel"
            data-has-catalog-total="${useCatalogPrice ? "1" : "0"}"
            data-catalog-total="${useCatalogPrice ? String(catalogNum) : ""}"
          >
            ${totalRow}
            <label class="booking-pay-field-label">Advance received (₹)<input type="number" inputmode="numeric" min="0" step="1" class="booking-pay-field" placeholder="0" data-advance-inr /></label>
            <p class="booking-balance-preview" data-balance-preview>Balance due: —</p>
            <button type="button" class="btn-confirm-booking" data-confirm-booking="${id}" disabled>
              Record advance
            </button>
          </div>`;
        }
        return `
        <div class="booking-item">
          <div>
            <h4>${escapeHtml(String(booking.travelDestination ?? ""))}</h4>
            <div class="booking-detail"><strong>Name:</strong> ${escapeHtml(String(booking.fullName ?? ""))}</div>
            <div class="booking-detail"><strong>Travelers:</strong> ${escapeHtml(bookingTravelersSummary(booking) || "—")}</div>
            <div class="booking-detail"><strong>Type:</strong> ${booking.tripType === "defined_trip" ? "Defined trip" : "Planned trip"}</div>
            <div class="booking-detail"><strong>Payment:</strong> <span class="badge ${paymentBadgeClass(booking)}">${paymentBadgeText(booking)}</span></div>
          </div>
          <div>
            <div class="booking-detail"><strong>Mobile:</strong> ${escapeHtml(String(booking.mobile ?? ""))}</div>
            <div class="booking-detail"><strong>Email:</strong> ${escapeHtml(String(booking.email ?? "N/A"))}</div>
            <div class="booking-detail"><strong>People:</strong> ${escapeHtml(String(booking.numberOfPeople ?? ""))}</div>
          </div>
          <div>
            <div class="booking-detail"><strong>Travel date:</strong> ${new Date(String(booking.dateOfTravel ?? "")).toLocaleDateString()}</div>
            <div class="booking-detail"><strong>Booked on:</strong> ${new Date(String(booking.createdAt ?? "")).toLocaleDateString()}</div>
          </div>
          <div class="booking-item-actions">
            ${confirmBlock}
            <div class="booking-admin-tools">
              <button type="button" class="btn-second" data-add-members="${id}">Add travelers</button>
              <button type="button" class="btn-danger-outline" data-delete-booking="${id}">Delete booking</button>
            </div>
          </div>
        </div>
      `;
    })
        .join("");
    listEl.innerHTML = html;
}
async function loadTrips(search = "") {
    try {
        const data = await fetchJson(`${API_BASE_URL}/admin/trips?search=${encodeURIComponent(search)}`);
        const trips = (data.trips || []);
        if (trips.length === 0) {
            document.getElementById("tripScrollContainer").innerHTML =
                '<p class="empty-hint">No trips found.</p>';
            return;
        }
        const html = trips
            .map((trip) => `
        <div class="trip-card-scroll">
          <img src="${trip.imageUrl || "./assets/lake.jpg"}" alt="${escapeHtml(trip.title)}">
          <div class="trip-card-info">
            <h4>${escapeHtml(trip.title)}</h4>
            <p>${escapeHtml(trip.location)}</p>
            <p>${escapeHtml(trip.durationLabel)} · ₹${Number(trip.price).toLocaleString("en-IN")}</p>
            <p style="margin-top:8px;font-size:12px;">${new Date(trip.startDate).toLocaleDateString()}</p>
          </div>
        </div>
      `)
            .join("");
        document.getElementById("tripScrollContainer").innerHTML = html;
    }
    catch (error) {
        document.getElementById("tripScrollContainer").innerHTML = `<p class="error-text">${error instanceof Error ? error.message : "Failed to load trips"}</p>`;
    }
}
document.getElementById("tripSearchBtn").addEventListener("click", () => {
    const search = document.getElementById("tripSearchInput").value.trim();
    loadTrips(search);
});
document.getElementById("tripSearchInput").addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
        document.getElementById("tripSearchBtn").click();
    }
});
document.getElementById("bookingSearchBtn").addEventListener("click", async () => {
    const search = document.getElementById("bookingSearchInput").value.trim();
    lastBookingSearch = search;
    try {
        const bookings = await fetchBookings(search);
        renderBookingList(bookings);
    }
    catch (error) {
        document.getElementById("bookingList").innerHTML = `<p class="error-text">${error instanceof Error ? error.message : "Failed to load bookings"}</p>`;
    }
});
document.getElementById("bookingSearchInput").addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
        document.getElementById("bookingSearchBtn").click();
    }
});
document.getElementById("tripForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const statusEl = document.getElementById("tripFormStatus");
    statusEl.textContent = "Adding trip…";
    statusEl.className = "";
    try {
        const payload = {
            title: document.getElementById("tripTitle").value.trim(),
            location: document.getElementById("tripLocation").value.trim(),
            duration_label: document.getElementById("tripDuration").value.trim(),
            price: Number(document.getElementById("tripPrice").value),
            start_date: document.getElementById("tripStartDate").value,
            end_date: document.getElementById("tripEndDate").value,
            image_name: document.getElementById("tripImageName").value.trim(),
            published: true,
            trip_style: document.getElementById("tripStyle").value,
        };
        const pdfInput = document.getElementById("newTripItineraryPdf");
        const pdfFile = pdfInput?.files?.[0] ?? null;
        const response = await fetch(`${API_BASE_URL}/admin/trips`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify(payload),
        });
        const data = (await response.json().catch(() => ({})));
        if (!response.ok)
            throw new Error(await parseError(response, data));
        if (pdfFile && data.trip_id) {
            statusEl.textContent = "Uploading itinerary PDF…";
            await uploadTripItineraryPdf(String(data.trip_id), pdfFile);
        }
        statusEl.textContent = "Trip added successfully.";
        statusEl.className = "status-message success";
        event.target.reset();
        if (pdfInput)
            pdfInput.value = "";
        await loadStats();
        await loadTrips();
        await loadTripManageList(lastTripManageSearch);
        lastBookingSearch = "";
        const bookings = await fetchBookings("");
        renderBookingList(bookings);
        renderRecentBookings(bookings);
    }
    catch (error) {
        statusEl.textContent = (error instanceof Error ? error.message : "Failed to add trip") || "Error";
        statusEl.className = "status-message error";
    }
});
document.getElementById("bookingList").addEventListener("input", (e) => {
    const t = e.target;
    if (!t?.closest("[data-advance-inr], [data-trip-total]"))
        return;
    const panel = t.closest(".booking-pay-panel");
    if (panel instanceof HTMLElement)
        syncBookingConfirmPanel(panel);
}, true);
document.getElementById("bookingList").addEventListener("click", async (e) => {
    const target = e.target;
    const delBtn = target.closest("[data-delete-booking]");
    if (delBtn) {
        const id = delBtn.getAttribute("data-delete-booking");
        if (!id)
            return;
        if (!window.confirm("Delete this booking permanently? This cannot be undone. Use only for spam or mistaken submissions."))
            return;
        try {
            await deleteBookingById(id);
            await loadStats();
            const bookings = await fetchBookings(lastBookingSearch);
            renderBookingList(bookings);
            if (lastBookingSearch === "")
                renderRecentBookings(bookings);
        }
        catch (err) {
            window.alert(err instanceof Error ? err.message : "Delete failed");
        }
        return;
    }
    const addBtn = target.closest("[data-add-members]");
    if (addBtn) {
        const id = addBtn.getAttribute("data-add-members");
        if (!id)
            return;
        const bookings = await fetchBookings(lastBookingSearch);
        const booking = bookings.find((b) => String(b._id) === id);
        if (booking)
            openAddMembersModal(booking);
        return;
    }
    const markBtn = target.closest("[data-mark-full-payment]");
    if (markBtn instanceof HTMLButtonElement) {
        const id = markBtn.getAttribute("data-mark-full-payment");
        if (!id || markBtn.disabled)
            return;
        if (!window.confirm("Mark this booking as fully paid? The traveler will be emailed that the remaining balance is ₹0.")) {
            return;
        }
        markBtn.disabled = true;
        const prevLabel = markBtn.textContent || "Mark full payment received";
        markBtn.textContent = "Updating…";
        try {
            await fetchJson(`${API_BASE_URL}/admin/bookings/mark-full-payment`, {
                method: "POST",
                body: JSON.stringify({ booking_id: id }),
            });
            const [, bookings] = await Promise.all([loadStats(), fetchBookings(lastBookingSearch)]);
            renderBookingList(bookings);
            if (lastBookingSearch === "")
                renderRecentBookings(bookings);
        }
        catch (err) {
            window.alert(err instanceof Error ? err.message : "Could not mark full payment");
            markBtn.disabled = false;
            markBtn.textContent = prevLabel;
        }
        return;
    }
    const trigger = target.closest("[data-confirm-booking]");
    if (!trigger || !(trigger instanceof HTMLButtonElement))
        return;
    const id = trigger.getAttribute("data-confirm-booking");
    if (!id || trigger.disabled)
        return;
    const panel = trigger.closest(".booking-pay-panel");
    const advanceEl = panel?.querySelector("[data-advance-inr]");
    const advance = advanceEl ? parseRupeeField(advanceEl.value) : undefined;
    let trip_total_inr;
    if (panel?.getAttribute("data-has-catalog-total") !== "1") {
        const tripEl = panel?.querySelector("[data-trip-total]");
        trip_total_inr = tripEl ? parseRupeeField(tripEl.value) : undefined;
        if (trip_total_inr === undefined) {
            window.alert("Enter the quoted package total in rupees (whole amounts only).");
            return;
        }
    }
    if (advance === undefined) {
        window.alert("Enter the advance payment received.");
        return;
    }
    const payload = { booking_id: id, advance_payment_inr: advance };
    if (trip_total_inr !== undefined)
        payload.trip_total_inr = trip_total_inr;
    trigger.disabled = true;
    const prevConfirmLabel = trigger.textContent || "Record advance";
    trigger.textContent = "Saving…";
    try {
        await fetchJson(`${API_BASE_URL}/admin/bookings/confirm-payment`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        const [, bookings] = await Promise.all([loadStats(), fetchBookings(lastBookingSearch)]);
        renderBookingList(bookings);
        if (lastBookingSearch === "") {
            renderRecentBookings(bookings);
        }
    }
    catch (err) {
        window.alert(err instanceof Error ? err.message : "Could not confirm booking");
        trigger.disabled = false;
        trigger.textContent = prevConfirmLabel;
        if (panel instanceof HTMLElement)
            syncBookingConfirmPanel(panel);
    }
});
document.getElementById("tripManageList")?.addEventListener("click", async (e) => {
    const target = e.target;
    const editBtn = target.closest("[data-edit-trip]");
    if (editBtn) {
        const editId = editBtn.getAttribute("data-edit-trip");
        if (editId) {
            const trip = lastTripManageRows.find((x) => String(x._id) === editId);
            if (trip)
                openEditTripModal(trip);
        }
        return;
    }
    const delBtn = target.closest("[data-delete-trip]");
    if (delBtn) {
        const delId = delBtn.getAttribute("data-delete-trip");
        if (delId) {
            if (!window.confirm("Delete this trip from the catalogue? Existing bookings keep their record."))
                return;
            try {
                await deleteTripById(delId);
                await loadTripManageList(lastTripManageSearch);
                await loadTrips(document.getElementById("tripSearchInput")?.value?.trim() || "");
                await loadStats();
            }
            catch (err) {
                window.alert(err instanceof Error ? err.message : "Delete failed");
            }
        }
        return;
    }
    const clearBtn = target.closest("[data-clear-itin]");
    if (clearBtn && clearBtn instanceof HTMLButtonElement && !clearBtn.disabled) {
        const clearId = clearBtn.getAttribute("data-clear-itin");
        if (clearId && window.confirm("Remove the PDF itinerary text from this trip?")) {
            try {
                await clearTripItineraryPdf(clearId);
                await loadTripManageList(lastTripManageSearch);
            }
            catch (err) {
                window.alert(err instanceof Error ? err.message : "Could not clear itinerary");
            }
        }
    }
});
document.getElementById("tripManageList")?.addEventListener("change", async (e) => {
    const inp = e.target;
    if (!inp.classList.contains("trip-itin-file"))
        return;
    const id = inp.getAttribute("data-upload-itin");
    const file = inp.files?.[0];
    inp.value = "";
    if (!file || !id)
        return;
    try {
        await uploadTripItineraryPdf(id, file);
        await loadTripManageList(lastTripManageSearch);
    }
    catch (err) {
        window.alert(err instanceof Error ? err.message : "Upload failed");
    }
});
document.getElementById("adminTripManageSearchBtn")?.addEventListener("click", () => {
    const q = document.getElementById("adminTripManageSearch").value.trim();
    void loadTripManageList(q);
});
document.getElementById("adminTripManageSearch")?.addEventListener("keyup", (e) => {
    if (e.key === "Enter")
        document.getElementById("adminTripManageSearchBtn").click();
});
document.addEventListener("DOMContentLoaded", async () => {
    await loadStats();
    try {
        lastBookingSearch = "";
        const bookings = await fetchBookings("");
        renderBookingList(bookings);
        renderRecentBookings(bookings);
    }
    catch (error) {
        document.getElementById("bookingList").innerHTML = `<p class="error-text">${error instanceof Error ? error.message : "Failed to load bookings"}</p>`;
        document.getElementById("recentBookingsList").innerHTML =
            '<p class="empty-hint">Could not load recent bookings.</p>';
    }
    await loadTrips();
});
