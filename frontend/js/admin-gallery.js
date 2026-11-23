import { API_BASE_URL, parseError } from "./config.js";
import { inclusiveDays, prettyRange, wireDateRange } from "./date-range.js";
import { districtFromTarget, districtName, eventToMapXY, getStateMapMeta, loadStateMapManifest, markDistricts, mountStateMap, projectLatLng, unprojectXY, } from "./state-maps.js";
let states = [];
let mode = "browse";
let activeStateId = "";
let activePlaceId = "";
let browseDistrict = ""; // district filter in browse view
let newTripId = ""; // trip to open expanded after it is created
let pinDraft = { lat: null, lng: null, districtId: "" };
let draft = blankDraft();
let previewUrls = [];
function blankDraft() {
    return {
        step: 1,
        stateId: "",
        districtId: "",
        placeId: "",
        newName: "",
        newArea: "",
        lat: null,
        lng: null,
        skipPin: false,
        label: "",
        startDate: "",
        endDate: "",
        travelers: "",
        story: "",
        files: [],
        error: "",
        busy: "",
        publishedTitle: "",
        publishedPlaceId: "",
    };
}
/* ───────────── helpers ───────────── */
function esc(raw) {
    return String(raw ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function token() {
    return localStorage.getItem("wb_token") ?? "";
}
async function api(path, method = "GET", body) {
    const res = await fetch(`${API_BASE_URL}/admin/travel-gallery${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token()}`,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok)
        throw new Error(await parseError(res));
    return (await res.json());
}
function root() {
    return document.getElementById("galleryAdmin");
}
function toast(message, isError = false) {
    const el = document.getElementById("galleryToast");
    if (!el)
        return;
    el.textContent = message;
    el.className = `gallery-toast${isError ? " is-error" : message ? " is-ok" : ""}`;
    if (message && !isError) {
        window.setTimeout(() => {
            if (el.textContent === message)
                el.textContent = "";
        }, 3500);
    }
}
const currentState = () => states.find((s) => s.id === activeStateId);
const currentPlace = () => currentState()?.places?.find((p) => p.id === activePlaceId);
function applyDestination(dest) {
    if (!dest)
        return;
    const idx = states.findIndex((s) => s.id === dest.id);
    if (idx >= 0)
        states[idx] = dest;
    else
        states.push(dest);
}
const placeCover = (p) => p.heroImage || p.visits?.flatMap((v) => v.photos ?? [])[0] || "";
const countPhotos = (p) => (p.visits ?? []).reduce((n, v) => n + (v.photos?.length ?? 0), 0);
const tripCount = (s) => (s.places ?? []).reduce((n, p) => n + (p.visits?.length ?? 0), 0);
function districtCounts(state) {
    const out = {};
    (state?.places ?? []).forEach((p) => {
        if (p.districtId)
            out[p.districtId] = (out[p.districtId] ?? 0) + (p.visits?.length ?? 0);
    });
    return out;
}
function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
const metaCache = new Map();
async function metaFor(state) {
    const code = state?.svgStateId;
    if (!code)
        return null;
    if (!metaCache.has(code))
        metaCache.set(code, await getStateMapMeta(code));
    return metaCache.get(code) ?? null;
}
/** Centre of a state's outline on the India map (where its pin goes). */
async function indiaPinFor(code) {
    try {
        const text = await (await fetch("/assets/india-map.svg")).text();
        const holder = document.createElement("div");
        holder.style.cssText = "position:absolute;left:-9999px;top:0;width:612px;height:696px;visibility:hidden";
        holder.innerHTML = text;
        document.body.appendChild(holder);
        const path = holder.querySelector(`#${code}`);
        const box = path?.getBBox();
        holder.remove();
        if (box)
            return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    }
    catch {
        /* fall through */
    }
    return { x: 306, y: 348 };
}
function mapShell(meta, role, note = "") {
    if (!meta) {
        return `<div class="gmap-missing">No district map for this state yet. You can still add places — just skip the pin.</div>`;
    }
    return `<div class="gmap" data-map-host data-role="${role}" style="aspect-ratio:${meta.w} / ${meta.h}">
      <div class="gmap-stage"></div><div class="gmap-pins"></div>
    </div>${note ? `<p class="gmap-note">${note}</p>` : ""}`;
}
function mapConfig(role) {
    const state = role === "wiz-district" || role === "wiz-pin" ? states.find((s) => s.id === draft.stateId) : currentState();
    const counts = districtCounts(state);
    const existing = (state?.places ?? [])
        .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
        .map((p) => ({ lat: p.lat, lng: p.lng, label: p.name }));
    switch (role) {
        case "browse":
            return { selected: browseDistrict || null, pins: existing, counts };
        case "wiz-district":
            return { selected: draft.districtId || null, pins: existing, counts };
        case "wiz-pin": {
            const pins = [...existing];
            if (draft.lat !== null && draft.lng !== null) {
                pins.push({ lat: draft.lat, lng: draft.lng, label: draft.newName || "New place", active: true });
            }
            return { selected: draft.districtId || null, pins, counts };
        }
        case "place-pin": {
            const pins = [];
            if (pinDraft.lat !== null && pinDraft.lng !== null) {
                pins.push({ lat: pinDraft.lat, lng: pinDraft.lng, label: currentPlace()?.name ?? "", active: true });
            }
            return { selected: pinDraft.districtId || null, pins, counts };
        }
    }
}
async function hydrateMap(host) {
    const role = host.dataset.role;
    const state = role === "wiz-district" || role === "wiz-pin" ? states.find((s) => s.id === draft.stateId) : currentState();
    const meta = await metaFor(state);
    const stage = host.querySelector(".gmap-stage");
    const pinsEl = host.querySelector(".gmap-pins");
    if (!meta || !stage || !pinsEl)
        return;
    const svg = await mountStateMap(stage, meta);
    if (!svg)
        return;
    svg.classList.add("wb-state-svg--light");
    const cfg = mapConfig(role);
    markDistricts(svg, cfg.counts, cfg.selected);
    pinsEl.innerHTML = cfg.pins
        .map((p) => {
        const pt = projectLatLng(meta, p.lat, p.lng);
        return `<span class="gmap-pin${p.active ? " is-active" : ""}" title="${esc(p.label)}"
        style="left:${((pt.x / meta.w) * 100).toFixed(2)}%;top:${((pt.y / meta.h) * 100).toFixed(2)}%"></span>`;
    })
        .join("");
    svg.querySelectorAll(".wb-districts [data-district]").forEach((path) => {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
        const n = cfg.counts[path.getAttribute("data-district") ?? ""] ?? 0;
        t.textContent = `${path.getAttribute("data-name")}${n ? ` · ${n} trip${n === 1 ? "" : "s"}` : ""}`;
        path.appendChild(t);
    });
}
async function hydrateMaps() {
    const hosts = Array.from(root()?.querySelectorAll("[data-map-host]") ?? []);
    await Promise.all(hosts.map(hydrateMap));
}
async function onMapClick(host, event) {
    const role = host.dataset.role;
    const districtId = districtFromTarget(event.target);
    const svg = host.querySelector("svg");
    const state = role === "wiz-district" || role === "wiz-pin" ? states.find((s) => s.id === draft.stateId) : currentState();
    const meta = await metaFor(state);
    if (role === "browse") {
        browseDistrict = districtId && districtId !== browseDistrict ? districtId : "";
        render();
        return;
    }
    if (role === "wiz-district") {
        if (!districtId)
            return;
        draft.districtId = districtId;
        draft.error = "";
        render();
        return;
    }
    // pin roles: a click both drops the pin and tells us the district
    if (!svg || !meta)
        return;
    const xy = eventToMapXY(svg, event);
    if (!xy)
        return;
    const { lat, lng } = unprojectXY(meta, xy.x, xy.y);
    const rLat = Math.round(lat * 10000) / 10000;
    const rLng = Math.round(lng * 10000) / 10000;
    if (role === "wiz-pin") {
        draft.lat = rLat;
        draft.lng = rLng;
        draft.skipPin = false;
        if (districtId && districtId !== draft.districtId) {
            draft.districtId = districtId;
            toast(`District set to ${districtName(meta, districtId)} (from where you clicked).`);
        }
        draft.error = "";
        render();
    }
    else {
        pinDraft = { lat: rLat, lng: rLng, districtId: districtId || pinDraft.districtId };
        const sel = document.getElementById("gpDistrict");
        if (sel && districtId)
            sel.value = districtId;
        const out = document.getElementById("gpCoords");
        if (out)
            out.textContent = `${rLat}, ${rLng}`;
        void hydrateMap(host);
    }
}
/* ───────────── dates (end can't be before start; text + days fill themselves) ───────────── */
function wireTripCardDates(card) {
    const q = (n) => card.querySelector(`[data-f="${n}"]`);
    const start = q("startDate");
    const end = q("endDate");
    const dates = q("dates");
    const days = q("days");
    if (!start || !end)
        return;
    let datesManual = !!dates?.value && !!dates.value.trim();
    dates?.addEventListener("input", (e) => {
        if (e.isTrusted)
            datesManual = true;
    });
    const fill = (info) => {
        if (!info.valid)
            return;
        if (dates && !datesManual)
            dates.value = info.pretty;
        if (days)
            days.value = String(info.days);
    };
    const handle = wireDateRange({ start, end, summary: card.querySelector("[data-date-summary]"), onChange: fill });
    // changing the dates re-takes control of the text, even if it was typed before
    const retake = () => {
        datesManual = false;
        fill(handle.info());
    };
    start.addEventListener("change", retake);
    end.addEventListener("change", retake);
}
function wireWizardDates() {
    const start = document.getElementById("wizStart");
    const end = document.getElementById("wizEnd");
    if (!start || !end)
        return;
    wireDateRange({
        start,
        end,
        summary: document.getElementById("wizDateSummary"),
        onChange: () => {
            draft.startDate = start.value;
            draft.endDate = end.value;
        },
    });
}
/* ───────────── rendering: shared bits ───────────── */
function renderTopBar() {
    const chips = states
        .map((s) => {
        const n = s.places?.length ?? 0;
        const on = mode !== "wizard" && s.id === activeStateId;
        return `<button type="button" class="gallery-chip${on ? " is-active" : ""}" data-action="pick-state" data-state="${esc(s.id)}">
        ${esc(s.state)} <span class="gallery-chip-count">${n}</span></button>`;
    })
        .join("");
    return `
    <div class="gallery-topbar">
      <button type="button" class="gallery-add-trip" data-action="start-wizard"><span aria-hidden="true">＋</span> Add a trip</button>
      <div class="gallery-chips">${chips}</div>
    </div>
    <p id="galleryToast" class="gallery-toast" aria-live="polite"></p>`;
}
function render() {
    const host = root();
    if (!host)
        return;
    previewUrls.forEach((u) => URL.revokeObjectURL(u));
    previewUrls = [];
    const state = currentState();
    const place = currentPlace();
    let body;
    if (mode === "wizard")
        body = renderWizard();
    else if (!state)
        body = `<p class="form-hint">Pick a state above, or start with “Add a trip”.</p>`;
    else if (mode === "place" && place)
        body = renderPlaceView(state, place);
    else
        body = renderStateView(state);
    host.innerHTML = renderTopBar() + body;
    void hydrateMaps();
    if (mode === "wizard") {
        attachWizardPreviews();
        wireWizardDates();
    }
    else {
        host.querySelectorAll("[data-visit]").forEach(wireTripCardDates);
    }
}
/* ───────────── browse: state view ───────────── */
function placeCardHtml(p) {
    const cover = placeCover(p);
    const trips = p.visits?.length ?? 0;
    const where = [p.area, p.districtName].filter(Boolean).join(" · ");
    return `<button type="button" class="gallery-place-card" data-action="open-place" data-place="${esc(p.id)}">
    <span class="gallery-place-thumb">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" />` : "<span>No photo yet</span>"}</span>
    <span class="gallery-place-name">${esc(p.name)}</span>
    <span class="gallery-place-meta">${esc(where || "No district yet")}</span>
    <span class="gallery-place-meta">${trips} trip${trips === 1 ? "" : "s"} · ${countPhotos(p)} photos${typeof p.lat === "number" ? " · 📍" : ""}</span>
  </button>`;
}
function renderStateView(state) {
    const meta = metaCache.get(state.svgStateId ?? "") ?? null;
    const places = state.places ?? [];
    const shown = browseDistrict ? places.filter((p) => p.districtId === browseDistrict) : places;
    const counts = districtCounts(state);
    const districtChips = meta
        ? meta.districts
            .map((d) => {
            const n = counts[d.id] ?? 0;
            return `<button type="button" class="gallery-dchip${d.id === browseDistrict ? " is-active" : ""}${n ? " has-trips" : ""}" data-action="filter-district" data-district="${esc(d.id)}">${esc(d.name)}${n ? ` <b>${n}</b>` : ""}</button>`;
        })
            .join("")
        : "";
    const headline = browseDistrict ? `${districtName(meta, browseDistrict)} district` : state.state;
    return `
    <section class="panel gallery-section">
      <div class="gallery-state-grid">
        <div class="gallery-map-col">
          ${state.svgStateId ? mapShell(meta ?? { w: 1000, h: 1000 }, "browse", "Click a district to filter. Gold = we have trips there.") : `<div class="gmap-missing">This state has no district map. Set one under “State settings”.</div>`}
        </div>
        <div class="gallery-places-col">
          <div class="gallery-section-head">
            <div><h4>${esc(headline)}</h4>
              <p class="form-hint">${places.length} place${places.length === 1 ? "" : "s"} · ${tripCount(state)} trip${tripCount(state) === 1 ? "" : "s"}${browseDistrict ? ` · showing ${shown.length}` : ""}</p></div>
            <button type="button" class="btn-second" data-action="start-wizard" data-from="place">＋ New place</button>
          </div>
          ${districtChips ? `<div class="gallery-dchips">${districtChips}</div>` : ""}
          <div class="gallery-place-grid">
            ${shown.map(placeCardHtml).join("") || `<p class="form-hint">${browseDistrict ? "No places in this district yet." : "No places yet — use “Add a trip”."}</p>`}
          </div>
        </div>
      </div>
    </section>

    <details class="panel gallery-section">
      <summary class="gallery-summary">State settings (map &amp; status)</summary>
      <div class="form-row">
        <div class="form-group"><label>State name</label><input type="text" id="gsName" value="${esc(state.state)}" maxlength="80" /></div>
        <div class="form-group"><label>Status</label>
          <select id="gsStatus">
            <option value="completed" ${state.status === "completed" ? "selected" : ""}>Completed (we've been)</option>
            <option value="coming_soon" ${state.status === "coming_soon" ? "selected" : ""}>Coming soon</option>
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Map pin label (India map)</label><input type="text" id="gsPin" value="${esc(state.pinSubtitle)}" placeholder="Jun 2026 or Coming Soon" maxlength="60" /></div>
        <div class="form-group"><label>State cover image path</label><input type="text" id="gsHero" value="${esc(state.heroImage)}" placeholder="/assets/..." /></div>
      </div>
      <button type="button" class="btn-primary" data-action="save-state">Save state</button>
    </details>`;
}
/* ───────────── browse: place view (edit place + its trips) ───────────── */
function renderPhotoThumb(path, cover) {
    return `<figure class="gallery-thumb${path === cover ? " is-cover" : ""}" data-photo="${esc(path)}">
    <img src="${esc(path)}" alt="" loading="lazy" />
    <button type="button" class="gallery-thumb-btn gallery-thumb-cover" data-action="make-cover" title="Use as place cover">★</button>
    <button type="button" class="gallery-thumb-btn gallery-thumb-del" data-action="remove-photo" title="Remove from this trip">✕</button>
  </figure>`;
}
function renderReview(t) {
    return `<div class="gallery-edit-row" data-review>
    <div class="form-group"><label>Traveler name</label><input type="text" data-review-name value="${esc(t.name)}" maxlength="80" /></div>
    <div class="form-group"><label>Review</label><textarea data-review-quote rows="3">${esc(t.quote)}</textarea></div>
    <button type="button" class="btn-second gallery-remove-row" data-action="remove-row">Remove review</button>
  </div>`;
}
function renderHighlight(h, listId) {
    return `<div class="gallery-edit-row gallery-edit-row--inline" data-highlight>
    <div class="form-group"><label>Title</label><input type="text" data-hl-title value="${esc(h.title)}" maxlength="120" /></div>
    <div class="form-group"><label>Photo</label><input type="text" data-hl-image list="${listId}" value="${esc(h.image)}" placeholder="pick from this trip's photos" /></div>
    <button type="button" class="btn-second gallery-remove-row" data-action="remove-row">Remove</button>
  </div>`;
}
function renderTrip(place, trip) {
    const photos = trip.photos ?? [];
    const listId = `hl-${trip.id}`;
    const title = trip.label || trip.dates || "Untitled trip";
    const open = newTripId === trip.id || (place.visits?.length ?? 0) === 1 ? "open" : "";
    return `
  <details class="panel gallery-visit" data-visit="${esc(trip.id)}" ${open}>
    <summary class="gallery-summary">
      <strong>${esc(title)}</strong>
      <span class="gallery-visit-meta">${esc(trip.dates ?? "")} · ${photos.length} photos · ${trip.testimonials?.length ?? 0} reviews</span>
    </summary>
    <div class="form-group"><label>Trip name</label><input type="text" data-f="label" value="${esc(trip.label)}" placeholder="e.g. Jibhi 2025" maxlength="120" /></div>
    <div class="form-row">
      <div class="form-group"><label>Start date</label><input type="date" data-f="startDate" value="${esc(trip.startDate)}" /></div>
      <div class="form-group"><label>End date</label><input type="date" data-f="endDate" value="${esc(trip.endDate)}" /></div>
      <div class="form-group"><label>Travelers</label><input type="number" min="0" data-f="travelers" value="${trip.travelers ?? ""}" /></div>
    </div>
    <div class="atf-datesummary" data-date-summary aria-live="polite"></div>
    <div class="form-row">
      <div class="form-group"><label>Dates as shown <span class="atf-auto">auto</span></label><input type="text" data-f="dates" value="${esc(trip.dates)}" placeholder="18–21 June 2026" maxlength="80" /></div>
      <div class="form-group"><label>Days <span class="atf-auto">auto</span></label><input type="number" min="0" data-f="days" value="${trip.days ?? ""}" /></div>
    </div>
    <div class="form-row full"><div class="form-group"><label>Story / caption</label><textarea data-f="story" rows="3" maxlength="1500">${esc(trip.story)}</textarea></div></div>
    <div class="form-row">
      <div class="form-group"><label>Trip details line (optional)</label><input type="text" data-f="tripMeta" value="${esc(trip.tripMeta)}" maxlength="240" /></div>
      <div class="form-group"><label>Reel link (optional)</label><input type="text" data-f="reelUrl" value="${esc(trip.reelUrl)}" placeholder="https://instagram.com/..." /></div>
    </div>

    <h5 class="gallery-sub">Photos</h5>
    <div class="gallery-dropzone" data-dropzone>
      <label class="btn-second gallery-upload-btn">+ Add photos
        <input type="file" data-photo-input accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden /></label>
      <span class="form-hint">Select many at once, or drop them here. Saved to this trip straight away. ★ sets the place cover.</span>
    </div>
    <div class="gallery-thumbs" data-thumbs>${photos.map((p) => renderPhotoThumb(p, place.heroImage ?? "")).join("")}</div>
    <datalist id="${listId}" data-photo-list>${photos.map((p) => `<option value="${esc(p)}"></option>`).join("")}</datalist>

    <div class="gallery-section-head"><h5 class="gallery-sub">Highlights</h5>
      <button type="button" class="btn-second" data-action="add-highlight" data-list="${listId}">+ Add highlight</button></div>
    <div data-highlights>${(trip.highlights ?? []).map((h) => renderHighlight(h, listId)).join("")}</div>

    <div class="gallery-section-head"><h5 class="gallery-sub">Traveler reviews</h5>
      <button type="button" class="btn-second" data-action="add-review">+ Add review</button></div>
    <div data-reviews>${(trip.testimonials ?? []).map(renderReview).join("")}</div>

    <div class="gallery-visit-actions">
      <button type="button" class="btn-primary" data-action="save-visit">Save this trip</button>
      <button type="button" class="btn-second gallery-danger" data-action="delete-visit">Delete trip</button>
    </div>
  </details>`;
}
function renderPlaceView(state, place) {
    const trips = place.visits ?? [];
    const cover = placeCover(place);
    const meta = metaCache.get(state.svgStateId ?? "") ?? null;
    pinDraft = { lat: place.lat ?? null, lng: place.lng ?? null, districtId: place.districtId ?? "" };
    const districtOptions = meta
        ? `<option value="">— choose a district —</option>` +
            meta.districts.map((d) => `<option value="${esc(d.id)}" ${d.id === place.districtId ? "selected" : ""}>${esc(d.name)}</option>`).join("")
        : `<option value="">(no district map for this state)</option>`;
    return `
    <button type="button" class="btn-second gallery-back" data-action="back-to-state">← All places in ${esc(state.state)}</button>

    <section class="panel gallery-section">
      <div class="gallery-place-head">
        <span class="gallery-place-thumb gallery-place-thumb--lg">${cover ? `<img src="${esc(cover)}" alt="" />` : "<span>No cover yet</span>"}</span>
        <div class="gallery-place-fields">
          <div class="form-group"><label>Place name</label><input type="text" id="gpName" value="${esc(place.name)}" maxlength="80" /></div>
          <div class="form-group"><label>Tagline</label><input type="text" id="gpTagline" value="${esc(place.tagline)}" placeholder="Short line shown on the map" maxlength="160" /></div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>District</label><select id="gpDistrict">${districtOptions}</select></div>
        <div class="form-group"><label>Area / valley (optional)</label><input type="text" id="gpArea" value="${esc(place.area)}" placeholder="e.g. Banjar Valley" maxlength="80" /></div>
      </div>
      <div class="form-row full"><div class="form-group"><label>About this place</label><textarea id="gpDesc" rows="2" maxlength="1500">${esc(place.description)}</textarea></div></div>

      <h5 class="gallery-sub">Pin on the map</h5>
      <p class="form-hint">Click the map where ${esc(place.name)} is. Current pin: <b id="gpCoords">${place.lat !== undefined && place.lng !== undefined ? `${place.lat}, ${place.lng}` : "not set"}</b></p>
      <div class="gallery-map-small">${state.svgStateId ? mapShell(meta ?? { w: 1000, h: 1000 }, "place-pin") : ""}</div>

      <div class="gallery-visit-actions">
        <button type="button" class="btn-primary" data-action="save-place">Save place</button>
        <button type="button" class="btn-second gallery-danger" data-action="delete-place">Delete place</button>
      </div>
    </section>

    <div class="gallery-section-head gallery-visits-head">
      <div><h4>Trips to ${esc(place.name)}</h4>
        <p class="form-hint">${trips.length ? "One entry per trip (Jibhi 2025, Jibhi 2026…). Went again? Add another trip." : "No trips logged yet — add the first one."}</p></div>
      <button type="button" class="btn-primary" data-action="add-visit">＋ ${trips.length ? "Add another trip" : "Add first trip"}</button>
    </div>
    ${trips.map((t) => renderTrip(place, t)).join("")}`;
}
/* ───────────── wizard: Add a trip ───────────── */
const STEP_TITLES = ["State", "District", "Place", "Trip"];
function wizardState() {
    return states.find((s) => s.id === draft.stateId);
}
function answersTrail() {
    const st = wizardState();
    const meta = metaCache.get(st?.svgStateId ?? "") ?? null;
    const place = st?.places?.find((p) => p.id === draft.placeId);
    const parts = [
        st?.state,
        draft.districtId ? districtName(meta, draft.districtId) : "",
        draft.placeId === "new" ? draft.newName : place?.name,
    ].filter(Boolean);
    return parts.length ? `<div class="wiz-trail">${parts.map((p) => `<span>${esc(p)}</span>`).join("<i>›</i>")}</div>` : "";
}
function renderWizard() {
    if (draft.step === 5)
        return renderWizardDone();
    const pct = ((draft.step - 1) / 4) * 100;
    const steps = STEP_TITLES.map((t, i) => `<li class="${i + 1 === draft.step ? "is-current" : i + 1 < draft.step ? "is-done" : ""}"><span>${i + 1 < draft.step ? "✓" : i + 1}</span>${t}</li>`).join("");
    let card = "";
    if (draft.step === 1)
        card = wizStepState();
    else if (draft.step === 2)
        card = wizStepDistrict();
    else if (draft.step === 3)
        card = wizStepPlace();
    else
        card = wizStepTrip();
    const last = draft.step === 4;
    return `
    <div class="wiz">
      <div class="wiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct + 12}%"></div></div>
      <ol class="wiz-steps">${steps}</ol>
      ${answersTrail()}
      <section class="wiz-card" data-step="${draft.step}">
        ${card}
        ${draft.error ? `<p class="wiz-error" role="alert">⚠ ${esc(draft.error)}</p>` : ""}
        <div class="wiz-actions">
          <button type="button" class="wiz-link" data-action="${draft.step === 1 ? "wiz-cancel" : "wiz-back"}">${draft.step === 1 ? "Cancel" : "← Back"}</button>
          <button type="button" class="wiz-next" data-action="${last ? "wiz-publish" : "wiz-next"}" ${draft.busy ? "disabled" : ""}>
            ${draft.busy ? esc(draft.busy) : last ? "Publish trip ✓" : "Next →"}</button>
        </div>
      </section>
    </div>`;
}
function choiceCard(opts) {
    return `<button type="button" class="wiz-choice${opts.selected ? " is-selected" : ""}" data-action="${opts.action}" ${opts.attrs} role="radio" aria-checked="${opts.selected}">
    <span class="wiz-radio" aria-hidden="true"></span>
    ${opts.img ? `<span class="wiz-choice-img"><img src="${esc(opts.img)}" alt="" loading="lazy" /></span>` : ""}
    <span class="wiz-choice-text"><strong>${esc(opts.title)}</strong>${opts.sub ? `<em>${esc(opts.sub)}</em>` : ""}</span>
  </button>`;
}
function wizStepState() {
    const cards = states
        .map((s) => choiceCard({
        action: "wiz-pick-state",
        attrs: `data-state="${esc(s.id)}"`,
        selected: s.id === draft.stateId,
        title: s.state,
        sub: `${s.places?.length ?? 0} place${(s.places?.length ?? 0) === 1 ? "" : "s"} · ${tripCount(s)} trip${tripCount(s) === 1 ? "" : "s"}`,
    }))
        .join("");
    return `
    <h3 class="wiz-q">Which state was the trip in? <span>*</span></h3>
    <p class="wiz-help">Pick one. Not listed? Add it below — it will appear on the India map.</p>
    <div class="wiz-choices" role="radiogroup">${cards}</div>
    <div class="wiz-addstate" id="wizAddState"><select id="wizNewStateSelect"><option value="">＋ Add another state…</option></select>
      <button type="button" class="btn-second" data-action="wiz-add-state">Add</button></div>`;
}
function wizStepDistrict() {
    const st = wizardState();
    const meta = metaCache.get(st?.svgStateId ?? "") ?? null;
    const counts = districtCounts(st);
    if (!meta) {
        return `<h3 class="wiz-q">Where in ${esc(st?.state)}?</h3>
      <p class="wiz-help">There's no district map for this state yet, so just continue — you can still add the place and trip.</p>`;
    }
    const cards = meta.districts
        .map((d) => choiceCard({
        action: "wiz-pick-district",
        attrs: `data-district="${esc(d.id)}"`,
        selected: d.id === draft.districtId,
        title: d.name,
        sub: counts[d.id] ? `${counts[d.id]} trip${counts[d.id] === 1 ? "" : "s"} so far` : "",
    }))
        .join("");
    return `
    <h3 class="wiz-q">Which district is it in? <span>*</span></h3>
    <p class="wiz-help">${esc(st?.state)} has ${meta.districts.length} districts. Click the map or pick from the list. (Jibhi → Kullu, Spiti → Lahaul and Spiti.)</p>
    <div class="wiz-split">
      <div class="wiz-map">${mapShell(meta, "wiz-district")}</div>
      <div class="wiz-choices wiz-choices--compact" role="radiogroup">${cards}</div>
    </div>`;
}
function wizStepPlace() {
    const st = wizardState();
    const meta = metaCache.get(st?.svgStateId ?? "") ?? null;
    const inDistrict = (st?.places ?? []).filter((p) => !draft.districtId || p.districtId === draft.districtId);
    const existing = inDistrict
        .map((p) => choiceCard({
        action: "wiz-pick-place",
        attrs: `data-place="${esc(p.id)}"`,
        selected: draft.placeId === p.id,
        title: p.name,
        sub: `${[p.area, `${p.visits?.length ?? 0} trip${(p.visits?.length ?? 0) === 1 ? "" : "s"}`].filter(Boolean).join(" · ")} — add another trip here`,
        img: placeCover(p),
    }))
        .join("");
    const isNew = draft.placeId === "new";
    const pinText = draft.lat !== null ? `📍 ${draft.lat}, ${draft.lng}` : "Click the map to drop a pin";
    return `
    <h3 class="wiz-q">Which place? <span>*</span></h3>
    <p class="wiz-help">${inDistrict.length ? `Already in ${esc(districtName(meta, draft.districtId) || st?.state)}: pick one to add another trip, or add a new place.` : "Nothing here yet — add the first place."}</p>
    <div class="wiz-choices" role="radiogroup">
      ${existing}
      ${choiceCard({ action: "wiz-pick-place", attrs: 'data-place="new"', selected: isNew, title: "＋ A new place", sub: "e.g. Jibhi, Tirthan, Kaza" })}
    </div>
    ${isNew
        ? `<div class="wiz-newplace">
            <div class="form-row">
              <div class="form-group"><label>Place name *</label><input type="text" id="wizNewName" value="${esc(draft.newName)}" maxlength="80" placeholder="Jibhi" /></div>
              <div class="form-group"><label>Area / valley (optional)</label><input type="text" id="wizNewArea" value="${esc(draft.newArea)}" maxlength="80" placeholder="Banjar Valley" /></div>
            </div>
            ${meta
            ? `<p class="wiz-help"><b>Drop the pin</b> — click where the place is on the map. ${pinText}</p>
                   <div class="wiz-map wiz-map--pin">${mapShell(meta, "wiz-pin")}</div>
                   <label class="wiz-check"><input type="checkbox" id="wizSkipPin" ${draft.skipPin ? "checked" : ""} /> I'll set the pin later</label>`
            : ""}
          </div>`
        : ""}`;
}
function wizStepTrip() {
    const st = wizardState();
    const place = st?.places?.find((p) => p.id === draft.placeId);
    const name = draft.placeId === "new" ? draft.newName : place?.name ?? "";
    const label = draft.label || `${name} ${new Date().getFullYear()}`.trim();
    return `
    <h3 class="wiz-q">Tell us about this trip to ${esc(name)}</h3>
    <p class="wiz-help">Only the trip name is required. Reviews and highlights can be added after publishing.</p>
    <div class="form-group"><label>Trip name *</label><input type="text" id="wizLabel" value="${esc(label)}" maxlength="120" placeholder="Jibhi 2026" /></div>
    <div class="form-row">
      <div class="form-group"><label>Start date</label><input type="date" id="wizStart" value="${esc(draft.startDate)}" /></div>
      <div class="form-group"><label>End date</label><input type="date" id="wizEnd" value="${esc(draft.endDate)}" /></div>
      <div class="form-group"><label>Travelers</label><input type="number" min="0" id="wizTravelers" value="${esc(draft.travelers)}" /></div>
    </div>
    <div id="wizDateSummary" class="atf-datesummary" aria-live="polite"></div>
    <div class="form-row full"><div class="form-group"><label>Story / caption</label>
      <textarea id="wizStory" rows="3" maxlength="1500" placeholder="A line or two about how it went…">${esc(draft.story)}</textarea></div></div>

    <h5 class="gallery-sub">Photos</h5>
    <div class="gallery-dropzone" data-wiz-drop>
      <label class="btn-second gallery-upload-btn">＋ Choose photos
        <input type="file" id="wizFiles" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden /></label>
      <span class="form-hint">${draft.files.length ? `${draft.files.length} selected` : "Select many at once, or drop them here."}</span>
    </div>
    <div class="gallery-thumbs" id="wizThumbs"></div>`;
}
function renderWizardDone() {
    return `
    <div class="wiz">
      <section class="wiz-card wiz-done">
        <div class="wiz-done-check" aria-hidden="true">✓</div>
        <h3 class="wiz-q">Published!</h3>
        <p class="wiz-help"><b>${esc(draft.publishedTitle)}</b> is now live on the Travel Gallery map.</p>
        <div class="wiz-actions wiz-actions--center">
          <button type="button" class="wiz-next" data-action="wiz-edit-published">Add reviews &amp; highlights →</button>
          <button type="button" class="btn-second" data-action="wiz-again">＋ Add another trip</button>
          <button type="button" class="wiz-link" data-action="wiz-cancel">Done</button>
        </div>
      </section>
    </div>`;
}
function attachWizardPreviews() {
    const thumbs = document.getElementById("wizThumbs");
    if (!thumbs)
        return;
    draft.files.forEach((f, i) => {
        const url = URL.createObjectURL(f);
        previewUrls.push(url);
        thumbs.insertAdjacentHTML("beforeend", `<figure class="gallery-thumb"><img src="${url}" alt="" /><button type="button" class="gallery-thumb-btn gallery-thumb-del" data-action="wiz-remove-file" data-index="${i}" title="Remove">✕</button></figure>`);
    });
}
/** Save whatever is typed on the current wizard step into the draft. */
function captureWizardInputs() {
    const v = (id) => document.getElementById(id)?.value.trim() ?? "";
    const has = (id) => !!document.getElementById(id);
    if (has("wizNewName"))
        draft.newName = v("wizNewName");
    if (has("wizNewArea"))
        draft.newArea = v("wizNewArea");
    if (has("wizSkipPin"))
        draft.skipPin = document.getElementById("wizSkipPin").checked;
    if (has("wizLabel")) {
        draft.label = v("wizLabel");
        draft.startDate = v("wizStart");
        draft.endDate = v("wizEnd");
        draft.travelers = v("wizTravelers");
        draft.story = v("wizStory");
    }
}
function validateStep(step) {
    if (step === 1 && !draft.stateId)
        return "Please choose a state to continue.";
    if (step === 2) {
        const meta = metaCache.get(wizardState()?.svgStateId ?? "") ?? null;
        if (meta && !draft.districtId)
            return "Please choose a district (click the map or pick from the list).";
    }
    if (step === 3) {
        if (!draft.placeId)
            return "Please choose a place, or add a new one.";
        if (draft.placeId === "new") {
            if (draft.newName.length < 2)
                return "Give the new place a name (at least 2 letters).";
            const meta = metaCache.get(wizardState()?.svgStateId ?? "") ?? null;
            if (meta && draft.lat === null && !draft.skipPin)
                return "Click the map to drop a pin — or tick “I'll set the pin later”.";
        }
    }
    if (step === 4 && draft.label.trim().length < 2)
        return "Please give the trip a name.";
    if (step === 4 && draft.startDate && !draft.endDate)
        return "Pick an end date too (or clear the start date).";
    if (step === 4 && draft.startDate && draft.endDate && draft.endDate < draft.startDate)
        return "The end date can't be before the start date.";
    return "";
}
async function wizardGo(step) {
    const st = wizardState();
    if (st)
        await metaFor(st); // make sure the district map is known before rendering steps 2-3
    draft.step = step;
    draft.error = "";
    render();
    document.querySelector(".wiz-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function wizardNext() {
    captureWizardInputs();
    const err = validateStep(draft.step);
    if (err) {
        draft.error = err;
        render();
        return;
    }
    // Step 2 → 3: if the place choice no longer matches the district, reset it.
    if (draft.step === 2) {
        const place = wizardState()?.places?.find((p) => p.id === draft.placeId);
        if (place && draft.districtId && place.districtId !== draft.districtId)
            draft.placeId = "";
    }
    if (draft.step === 3 && !draft.label) {
        const st = wizardState();
        const name = draft.placeId === "new" ? draft.newName : st?.places?.find((p) => p.id === draft.placeId)?.name ?? "";
        draft.label = `${name} ${new Date().getFullYear()}`.trim();
    }
    await wizardGo(Math.min(4, draft.step + 1));
}
async function wizardPublish() {
    captureWizardInputs();
    const err = validateStep(4);
    if (err) {
        draft.error = err;
        render();
        return;
    }
    const st = wizardState();
    if (!st)
        return;
    const meta = metaCache.get(st.svgStateId ?? "") ?? null;
    const setBusy = (text) => {
        draft.busy = text;
        const btn = document.querySelector(".wiz-next");
        if (btn) {
            btn.disabled = !!text;
            btn.textContent = text || "Publish trip ✓";
        }
    };
    try {
        let placeId = draft.placeId;
        let placeName = st.places?.find((p) => p.id === placeId)?.name ?? "";
        if (placeId === "new") {
            setBusy("Creating place…");
            const body = { name: draft.newName, area: draft.newArea };
            if (draft.districtId) {
                body.districtId = draft.districtId;
                body.districtName = districtName(meta, draft.districtId);
            }
            if (draft.lat !== null && draft.lng !== null) {
                body.lat = draft.lat;
                body.lng = draft.lng;
            }
            const created = await api(`/${st.id}/places`, "POST", body);
            applyDestination(created.destination);
            placeId = created.place.id;
            placeName = created.place.name;
        }
        setBusy("Saving trip…");
        const created = await api(`/${st.id}/places/${placeId}/visits`, "POST", {
            label: draft.label,
            ...(draft.startDate && draft.endDate
                ? {
                    startDate: draft.startDate,
                    endDate: draft.endDate,
                    visitedOn: draft.startDate.slice(0, 7),
                    dates: prettyRange(draft.startDate, draft.endDate),
                    days: inclusiveDays(draft.startDate, draft.endDate),
                }
                : {}),
            travelers: Number(draft.travelers) || 0,
            story: draft.story,
        });
        applyDestination(created.destination);
        const BATCH = 8;
        for (let i = 0; i < draft.files.length; i += BATCH) {
            const chunk = draft.files.slice(i, i + BATCH);
            setBusy(`Uploading photos ${Math.min(i + chunk.length, draft.files.length)} / ${draft.files.length}…`);
            const data = await postPhotos(st.id, placeId, created.visit.id, chunk);
            applyDestination(data.destination);
        }
        draft.publishedTitle = `${draft.label}${placeName && !draft.label.includes(placeName) ? ` · ${placeName}` : ""}`;
        draft.publishedPlaceId = placeId;
        activeStateId = st.id;
        newTripId = created.visit.id;
        draft.busy = "";
        draft.files = [];
        await wizardGo(5);
    }
    catch (e) {
        draft.busy = "";
        draft.error = e instanceof Error ? e.message : "Could not publish. Nothing was lost — try again.";
        render();
    }
}
/* ───────────── photos / API helpers ───────────── */
async function postPhotos(stateId, placeId, tripId, files) {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const res = await fetch(`${API_BASE_URL}/admin/travel-gallery/${encodeURIComponent(stateId)}/places/${encodeURIComponent(placeId)}/visits/${encodeURIComponent(tripId)}/photos`, { method: "POST", headers: { Authorization: `Bearer ${token()}` }, body: form });
    if (!res.ok)
        throw new Error(await parseError(res));
    return (await res.json());
}
async function run(task) {
    try {
        await task();
    }
    catch (err) {
        toast(err instanceof Error ? err.message : "Something went wrong", true);
    }
}
async function uploadPhotos(card, files) {
    const state = currentState();
    const place = currentPlace();
    const tripId = card.dataset.visit;
    if (!state || !place || !tripId || !files.length)
        return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
        toast("Only image files can be uploaded.", true);
        return;
    }
    const BATCH = 10;
    let done = 0;
    await run(async () => {
        for (let i = 0; i < images.length; i += BATCH) {
            const chunk = images.slice(i, i + BATCH);
            toast(`Uploading ${done + 1}–${done + chunk.length} of ${images.length}…`);
            const data = await postPhotos(state.id, place.id, tripId, chunk);
            const thumbs = card.querySelector("[data-thumbs]");
            const list = card.querySelector("[data-photo-list]");
            data.paths.forEach((p) => {
                thumbs?.insertAdjacentHTML("beforeend", renderPhotoThumb(p, place.heroImage ?? ""));
                list?.insertAdjacentHTML("beforeend", `<option value="${esc(p)}"></option>`);
            });
            applyDestination(data.destination);
            done += chunk.length;
        }
        toast(`${done} photo${done === 1 ? "" : "s"} added.`);
    });
}
function field(card, name) {
    return card.querySelector(`[data-f="${name}"]`)?.value.trim() ?? "";
}
function readTrip(card) {
    return {
        label: field(card, "label"),
        startDate: field(card, "startDate"),
        endDate: field(card, "endDate"),
        visitedOn: field(card, "startDate").slice(0, 7),
        dates: field(card, "dates"),
        travelers: Number(field(card, "travelers")) || 0,
        days: Number(field(card, "days")) || 0,
        story: field(card, "story"),
        tripMeta: field(card, "tripMeta"),
        reelUrl: field(card, "reelUrl"),
        photos: Array.from(card.querySelectorAll("[data-thumbs] [data-photo]")).map((el) => el.dataset.photo ?? ""),
        highlights: Array.from(card.querySelectorAll("[data-highlight]"))
            .map((row) => ({
            title: row.querySelector("[data-hl-title]")?.value.trim() ?? "",
            image: row.querySelector("[data-hl-image]")?.value.trim() ?? "",
        }))
            .filter((h) => h.title && h.image),
        testimonials: Array.from(card.querySelectorAll("[data-review]"))
            .map((row) => ({
            name: row.querySelector("[data-review-name]")?.value.trim() ?? "",
            quote: row.querySelector("[data-review-quote]")?.value.trim() ?? "",
        }))
            .filter((t) => t.name && t.quote),
    };
}
/* ───────────── click handling ───────────── */
async function handleClick(target, event) {
    const mapHost = target.closest("[data-map-host]");
    if (mapHost) {
        await onMapClick(mapHost, event);
        return;
    }
    const btn = target.closest("[data-action]");
    if (!btn)
        return;
    const action = btn.dataset.action;
    const state = currentState();
    const place = currentPlace();
    const card = btn.closest("[data-visit]");
    switch (action) {
        /* top bar */
        case "pick-state":
            activeStateId = btn.dataset.state ?? "";
            activePlaceId = "";
            browseDistrict = "";
            mode = "browse";
            await metaFor(currentState());
            render();
            break;
        case "start-wizard": {
            draft = blankDraft();
            if (btn.dataset.from === "place" && state) {
                draft.stateId = state.id;
                draft.districtId = browseDistrict;
                draft.placeId = "new";
                draft.step = browseDistrict ? 3 : 2;
                await metaFor(state);
            }
            mode = "wizard";
            render();
            break;
        }
        /* wizard */
        case "wiz-cancel":
            mode = "browse";
            draft = blankDraft();
            render();
            break;
        case "wiz-back":
            captureWizardInputs();
            await wizardGo(Math.max(1, draft.step - 1));
            break;
        case "wiz-next":
            await wizardNext();
            break;
        case "wiz-publish":
            await wizardPublish();
            break;
        case "wiz-pick-state":
            draft.stateId = btn.dataset.state ?? "";
            draft.districtId = "";
            draft.placeId = "";
            draft.lat = draft.lng = null;
            draft.error = "";
            await metaFor(wizardState());
            render();
            break;
        case "wiz-pick-district":
            draft.districtId = btn.dataset.district ?? "";
            draft.error = "";
            render();
            break;
        case "wiz-pick-place":
            captureWizardInputs();
            draft.placeId = btn.dataset.place ?? "";
            draft.error = "";
            render();
            break;
        case "wiz-remove-file":
            draft.files.splice(Number(btn.dataset.index), 1);
            captureWizardInputs();
            render();
            break;
        case "wiz-add-state": {
            const code = document.getElementById("wizNewStateSelect")?.value;
            if (!code)
                return;
            await run(async () => {
                const manifest = await loadStateMapManifest();
                const name = manifest[code]?.name ?? code;
                const pin = await indiaPinFor(code);
                const data = await api("", "POST", { state: name, svgStateId: code, mapPin: pin });
                applyDestination(data.destination);
                draft.stateId = data.destination.id;
                draft.districtId = "";
                await metaFor(data.destination);
                render();
                toast(`${name} added.`);
            });
            break;
        }
        case "wiz-again":
            draft = blankDraft();
            render();
            break;
        case "wiz-edit-published":
            activePlaceId = draft.publishedPlaceId;
            mode = "place";
            draft = blankDraft();
            render();
            break;
        /* browse */
        case "filter-district":
            browseDistrict = btn.dataset.district === browseDistrict ? "" : btn.dataset.district ?? "";
            render();
            break;
        case "open-place":
            activePlaceId = btn.dataset.place ?? "";
            mode = "place";
            await metaFor(currentState());
            render();
            break;
        case "back-to-state":
            activePlaceId = "";
            mode = "browse";
            render();
            break;
        case "save-state":
            if (!state)
                return;
            await run(async () => {
                const data = await api(`/${encodeURIComponent(state.id)}`, "PUT", {
                    state: document.getElementById("gsName").value.trim(),
                    status: document.getElementById("gsStatus").value,
                    pinSubtitle: document.getElementById("gsPin").value.trim(),
                    heroImage: document.getElementById("gsHero").value.trim(),
                });
                applyDestination(data.destination);
                render();
                toast("State saved.");
            });
            break;
        case "save-place":
            if (!state || !place)
                return;
            await run(async () => {
                const meta = await metaFor(state);
                const districtId = document.getElementById("gpDistrict").value;
                const body = {
                    name: document.getElementById("gpName").value.trim(),
                    tagline: document.getElementById("gpTagline").value.trim(),
                    description: document.getElementById("gpDesc").value.trim(),
                    area: document.getElementById("gpArea").value.trim(),
                    districtId,
                    districtName: districtName(meta, districtId),
                };
                if (pinDraft.lat !== null && pinDraft.lng !== null) {
                    body.lat = pinDraft.lat;
                    body.lng = pinDraft.lng;
                }
                const data = await api(`/${state.id}/places/${place.id}`, "PUT", body);
                applyDestination(data.destination);
                render();
                toast("Place saved.");
            });
            break;
        case "delete-place":
            if (!state || !place)
                return;
            if (!window.confirm(`Delete "${place.name}" and all ${place.visits?.length ?? 0} of its trips? Photos on disk are kept.`))
                return;
            await run(async () => {
                const data = await api(`/${state.id}/places/${place.id}`, "DELETE");
                applyDestination(data.destination);
                activePlaceId = "";
                mode = "browse";
                render();
                toast("Place deleted.");
            });
            break;
        case "add-visit":
            if (!state || !place)
                return;
            await run(async () => {
                const n = (place.visits?.length ?? 0) + 1;
                const data = await api(`/${state.id}/places/${place.id}/visits`, "POST", {
                    label: n === 1 ? `${place.name} ${new Date().getFullYear()}` : `${place.name} — trip ${n}`,
                });
                newTripId = data.visit.id;
                applyDestination(data.destination);
                render();
                document.querySelector(`[data-visit="${data.visit.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                toast("New trip added — fill in the details and save.");
            });
            break;
        case "save-visit":
            if (!state || !place || !card)
                return;
            await run(async () => {
                const data = await api(`/${state.id}/places/${place.id}/visits/${card.dataset.visit}`, "PUT", readTrip(card));
                applyDestination(data.destination);
                newTripId = card.dataset.visit ?? "";
                render();
                toast("Trip saved — live on the Travel Gallery.");
            });
            break;
        case "delete-visit":
            if (!state || !place || !card)
                return;
            if (!window.confirm("Delete this trip and its reviews? Photos on disk are kept."))
                return;
            await run(async () => {
                const data = await api(`/${state.id}/places/${place.id}/visits/${card.dataset.visit}`, "DELETE");
                applyDestination(data.destination);
                render();
                toast("Trip deleted.");
            });
            break;
        case "remove-photo":
            btn.closest("[data-photo]")?.remove();
            toast("Photo removed from this trip — click “Save this trip” to confirm.");
            break;
        case "make-cover": {
            const path = btn.closest("[data-photo]")?.dataset.photo;
            if (!state || !place || !path)
                return;
            await run(async () => {
                const data = await api(`/${state.id}/places/${place.id}`, "PUT", { heroImage: path });
                applyDestination(data.destination);
                document.querySelectorAll(".gallery-thumb").forEach((el) => el.classList.toggle("is-cover", el.dataset.photo === path));
                const big = document.querySelector(".gallery-place-thumb--lg img");
                if (big)
                    big.src = path;
                toast("Cover updated.");
            });
            break;
        }
        case "add-review":
            card?.querySelector("[data-reviews]")?.insertAdjacentHTML("beforeend", renderReview({ name: "", quote: "" }));
            break;
        case "add-highlight":
            card?.querySelector("[data-highlights]")?.insertAdjacentHTML("beforeend", renderHighlight({ title: "", image: "" }, btn.dataset.list ?? ""));
            break;
        case "remove-row":
            btn.closest("[data-review], [data-highlight]")?.remove();
            break;
    }
}
async function fillAddStateSelect() {
    const sel = document.getElementById("wizNewStateSelect");
    if (!sel || sel.dataset.filled)
        return;
    const manifest = await loadStateMapManifest();
    const used = new Set(states.map((s) => s.svgStateId));
    Object.entries(manifest)
        .filter(([code]) => !used.has(code))
        .sort((a, b) => a[1].name.localeCompare(b[1].name))
        .forEach(([code, m]) => sel.insertAdjacentHTML("beforeend", `<option value="${esc(code)}">${esc(m.name)}</option>`));
    sel.dataset.filled = "1";
}
function bindOnce(host) {
    if (host.dataset.bound)
        return;
    host.dataset.bound = "1";
    host.addEventListener("click", (event) => {
        void handleClick(event.target, event);
    });
    // keep typed answers when the wizard re-renders; Enter = Next (like a form)
    host.addEventListener("input", () => {
        if (mode === "wizard")
            captureWizardInputs();
    });
    host.addEventListener("keydown", (event) => {
        const e = event;
        if (mode !== "wizard" || e.key !== "Enter")
            return;
        const t = e.target;
        if (t.tagName === "TEXTAREA" || t.tagName === "SELECT")
            return;
        e.preventDefault();
        void (draft.step === 4 ? wizardPublish() : wizardNext());
    });
    host.addEventListener("change", (event) => {
        const input = event.target;
        if (input.matches("[data-photo-input]")) {
            const card = input.closest("[data-visit]");
            const files = Array.from(input.files ?? []);
            input.value = "";
            if (card)
                void uploadPhotos(card, files);
        }
        else if (input.id === "wizFiles") {
            captureWizardInputs();
            draft.files.push(...Array.from(input.files ?? []).filter((f) => f.type.startsWith("image/")));
            input.value = "";
            render();
        }
        else if (input.id === "wizSkipPin") {
            captureWizardInputs();
            if (draft.skipPin)
                draft.error = "";
        }
        else if (input.id === "gpDistrict") {
            pinDraft.districtId = input.value;
            const mapHost = host.querySelector('[data-role="place-pin"]');
            if (mapHost)
                void hydrateMap(mapHost);
        }
    });
    host.addEventListener("dragover", (event) => {
        const zone = event.target.closest("[data-dropzone], [data-wiz-drop]");
        if (!zone)
            return;
        event.preventDefault();
        zone.classList.add("is-over");
    });
    host.addEventListener("dragleave", (event) => {
        event.target.closest("[data-dropzone], [data-wiz-drop]")?.classList.remove("is-over");
    });
    host.addEventListener("drop", (event) => {
        const target = event.target;
        const zone = target.closest("[data-dropzone], [data-wiz-drop]");
        if (!zone)
            return;
        event.preventDefault();
        zone.classList.remove("is-over");
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (zone.hasAttribute("data-wiz-drop")) {
            captureWizardInputs();
            draft.files.push(...files.filter((f) => f.type.startsWith("image/")));
            render();
        }
        else {
            const card = zone.closest("[data-visit]");
            if (card)
                void uploadPhotos(card, files);
        }
    });
    // populate the "add another state" dropdown whenever the wizard's first step is drawn
    new MutationObserver(() => void fillAddStateSelect()).observe(host, { childList: true });
}
export async function loadAdminGalleryTab(_authHeaders) {
    const host = root();
    if (!host)
        return;
    bindOnce(host);
    try {
        const data = await api("");
        states = data.destinations ?? [];
    }
    catch (err) {
        host.innerHTML = `<p class="form-hint">${esc(err instanceof Error ? err.message : "Could not load Travel Gallery")}</p>`;
        return;
    }
    if (!states.some((s) => s.id === activeStateId)) {
        activeStateId = (states.find((s) => s.places?.length) ?? states[0])?.id ?? "";
        activePlaceId = "";
        mode = "browse";
    }
    await Promise.all(states.map((s) => metaFor(s)));
    render();
}
export function initAdminGallery(authHeaders) {
    void loadAdminGalleryTab(authHeaders);
}
