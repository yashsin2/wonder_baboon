import { API_BASE_URL, parseError } from "./config.js";
let galleryDestinations = [];
let activeGalleryId = "";
function escapeHtml(raw) {
    return raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
async function fetchGalleryList(authHeaders) {
    const res = await fetch(`${API_BASE_URL}/admin/travel-gallery`, { headers: authHeaders });
    if (!res.ok)
        throw new Error(await parseError(res));
    const data = (await res.json());
    return data.destinations ?? [];
}
function getEditorRoot() {
    return document.getElementById("galleryEditor");
}
function readTestimonialsFromDom() {
    const root = getEditorRoot();
    if (!root)
        return [];
    return Array.from(root.querySelectorAll("[data-gallery-review]"))
        .map((row) => ({
        name: row.querySelector("[data-review-name]")?.value.trim() ?? "",
        quote: row.querySelector("[data-review-quote]")?.value.trim() ?? "",
    }))
        .filter((t) => t.name && t.quote);
}
function readHighlightsFromDom() {
    const root = getEditorRoot();
    if (!root)
        return [];
    return Array.from(root.querySelectorAll("[data-gallery-highlight]"))
        .map((row) => ({
        title: row.querySelector("[data-highlight-title]")?.value.trim() ?? "",
        image: row.querySelector("[data-highlight-image]")?.value.trim() ?? "",
    }))
        .filter((h) => h.title && h.image);
}
function readPhotosFromDom() {
    const raw = document.getElementById("galleryPhotos")?.value ?? "";
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}
function renderReviewRow(t, index) {
    return `
    <div class="gallery-edit-row" data-gallery-review data-index="${index}">
      <div class="form-row full">
        <div class="form-group">
          <label>Traveler name</label>
          <input type="text" data-review-name value="${escapeHtml(t.name)}" maxlength="80" />
        </div>
      </div>
      <div class="form-row full">
        <div class="form-group">
          <label>Review</label>
          <textarea data-review-quote rows="4">${escapeHtml(t.quote)}</textarea>
        </div>
      </div>
      <button type="button" class="btn-second gallery-remove-row" data-remove-review="${index}">Remove review</button>
    </div>`;
}
function renderHighlightRow(h, index) {
    return `
    <div class="gallery-edit-row" data-gallery-highlight data-index="${index}">
      <div class="form-row">
        <div class="form-group">
          <label>Highlight title</label>
          <input type="text" data-highlight-title value="${escapeHtml(h.title)}" />
        </div>
        <div class="form-group">
          <label>Image path</label>
          <input type="text" data-highlight-image value="${escapeHtml(h.image)}" placeholder="/assets/..." />
        </div>
      </div>
      <button type="button" class="btn-second gallery-remove-row" data-remove-highlight="${index}">Remove highlight</button>
    </div>`;
}
function renderGalleryEditor(dest) {
    const root = getEditorRoot();
    if (!root)
        return;
    const testimonials = dest.testimonials ?? [];
    const highlights = dest.highlights ?? [];
    const photos = dest.photos ?? [];
    root.innerHTML = `
    <div class="gallery-editor-grid">
      <section class="panel gallery-editor-section">
        <h4>Trip details</h4>
        <div class="form-row">
          <div class="form-group">
            <label for="galleryStatus">Status</label>
            <select id="galleryStatus">
              <option value="completed" ${dest.status === "completed" ? "selected" : ""}>Completed</option>
              <option value="coming_soon" ${dest.status === "coming_soon" ? "selected" : ""}>Coming soon</option>
            </select>
          </div>
          <div class="form-group">
            <label for="galleryPinSubtitle">Map pin label</label>
            <input id="galleryPinSubtitle" type="text" value="${escapeHtml(dest.pinSubtitle ?? "")}" placeholder="Jun 2026 or Coming Soon" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="galleryDates">Dates</label>
            <input id="galleryDates" type="text" value="${escapeHtml(dest.dates ?? "")}" />
          </div>
          <div class="form-group">
            <label for="galleryTravelers">Travelers</label>
            <input id="galleryTravelers" type="number" min="0" value="${dest.travelers ?? ""}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="galleryDays">Days</label>
            <input id="galleryDays" type="number" min="0" value="${dest.days ?? ""}" />
          </div>
          <div class="form-group">
            <label for="galleryPhotoCount">Photo count label</label>
            <input id="galleryPhotoCount" type="text" value="${escapeHtml(dest.photoCountLabel ?? "")}" placeholder="250+" />
          </div>
        </div>
        <div class="form-row full">
          <div class="form-group">
            <label for="galleryHero">Hero image path</label>
            <input id="galleryHero" type="text" value="${escapeHtml(dest.heroImage ?? "")}" placeholder="/assets/Himachal/DSC04505.JPG" />
          </div>
        </div>
        <div class="form-row full">
          <div class="form-group">
            <label for="galleryStory">Journal story (cover page)</label>
            <textarea id="galleryStory" rows="3">${escapeHtml(dest.story ?? "")}</textarea>
          </div>
        </div>
      </section>

      <section class="panel gallery-editor-section">
        <h4>Photos</h4>
        <p class="form-hint">One path per line (e.g. <code>/assets/Himachal/DSC04505.JPG</code>) or upload below.</p>
        <textarea id="galleryPhotos" rows="6" placeholder="/assets/...">${escapeHtml(photos.join("\n"))}</textarea>
        <div class="form-row full gallery-upload-row">
          <div class="form-group">
            <label for="galleryPhotoFile">Upload new photo</label>
            <input id="galleryPhotoFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
          </div>
          <button type="button" class="btn-second" id="galleryUploadPhotoBtn">Upload &amp; append</button>
        </div>
      </section>

      <section class="panel gallery-editor-section">
        <div class="gallery-section-head">
          <h4>Traveler reviews</h4>
          <button type="button" class="btn-second" id="galleryAddReviewBtn">+ Add review</button>
        </div>
        <div id="galleryReviewsList">${testimonials.map(renderReviewRow).join("")}</div>
      </section>

      <section class="panel gallery-editor-section">
        <div class="gallery-section-head">
          <h4>Highlights</h4>
          <button type="button" class="btn-second" id="galleryAddHighlightBtn">+ Add highlight</button>
        </div>
        <div id="galleryHighlightsList">${highlights.map(renderHighlightRow).join("")}</div>
      </section>
    </div>

    <div class="gallery-save-row">
      <button type="button" class="btn-primary" id="gallerySaveBtn">Save Travel Gallery</button>
      <p class="form-hint" id="gallerySaveStatus" aria-live="polite"></p>
    </div>`;
    root.hidden = false;
    bindGalleryEditorEvents(dest.id, authHeadersFromRoot());
}
function authHeadersFromRoot() {
    const token = localStorage.getItem("wb_token");
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}
let boundAuthHeaders = {};
function bindGalleryEditorEvents(destId, authHeaders) {
    boundAuthHeaders = authHeaders;
    document.getElementById("galleryAddReviewBtn")?.addEventListener("click", () => {
        const list = document.getElementById("galleryReviewsList");
        if (!list)
            return;
        const index = list.querySelectorAll("[data-gallery-review]").length;
        list.insertAdjacentHTML("beforeend", renderReviewRow({ name: "", quote: "" }, index));
        bindRemoveReviewButtons();
    });
    document.getElementById("galleryAddHighlightBtn")?.addEventListener("click", () => {
        const list = document.getElementById("galleryHighlightsList");
        if (!list)
            return;
        const index = list.querySelectorAll("[data-gallery-highlight]").length;
        list.insertAdjacentHTML("beforeend", renderHighlightRow({ title: "", image: "" }, index));
        bindRemoveHighlightButtons();
    });
    bindRemoveReviewButtons();
    bindRemoveHighlightButtons();
    document.getElementById("galleryUploadPhotoBtn")?.addEventListener("click", () => {
        void uploadGalleryPhoto(destId);
    });
    document.getElementById("gallerySaveBtn")?.addEventListener("click", () => {
        void saveGalleryDestination(destId);
    });
}
function bindRemoveReviewButtons() {
    document.querySelectorAll("[data-remove-review]").forEach((btn) => {
        btn.onclick = () => btn.closest("[data-gallery-review]")?.remove();
    });
}
function bindRemoveHighlightButtons() {
    document.querySelectorAll("[data-remove-highlight]").forEach((btn) => {
        btn.onclick = () => btn.closest("[data-gallery-highlight]")?.remove();
    });
}
async function uploadGalleryPhoto(destId) {
    const input = document.getElementById("galleryPhotoFile");
    const status = document.getElementById("gallerySaveStatus");
    const file = input?.files?.[0];
    if (!file) {
        window.alert("Choose a photo file first.");
        return;
    }
    const token = localStorage.getItem("wb_token");
    const form = new FormData();
    form.append("file", file);
    if (status)
        status.textContent = "Uploading photo…";
    try {
        const res = await fetch(`${API_BASE_URL}/admin/travel-gallery/${encodeURIComponent(destId)}/photos`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
        });
        if (!res.ok)
            throw new Error(await parseError(res));
        const data = (await res.json());
        const photosEl = document.getElementById("galleryPhotos");
        if (photosEl && data.path) {
            const lines = photosEl.value.split("\n").map((l) => l.trim()).filter(Boolean);
            lines.push(data.path);
            photosEl.value = lines.join("\n");
        }
        if (data.destination) {
            const idx = galleryDestinations.findIndex((d) => d.id === destId);
            if (idx >= 0)
                galleryDestinations[idx] = data.destination;
        }
        if (status)
            status.textContent = "Photo uploaded. Click Save to publish other edits.";
        if (input)
            input.value = "";
    }
    catch (err) {
        window.alert(err instanceof Error ? err.message : "Upload failed");
        if (status)
            status.textContent = "";
    }
}
async function saveGalleryDestination(destId) {
    const status = document.getElementById("gallerySaveStatus");
    const btn = document.getElementById("gallerySaveBtn");
    const body = {
        status: document.getElementById("galleryStatus").value,
        pin_subtitle: document.getElementById("galleryPinSubtitle").value.trim(),
        dates: document.getElementById("galleryDates").value.trim(),
        travelers: Number(document.getElementById("galleryTravelers").value) || 0,
        days: Number(document.getElementById("galleryDays").value) || 0,
        photo_count_label: document.getElementById("galleryPhotoCount").value.trim(),
        hero_image: document.getElementById("galleryHero").value.trim(),
        story: document.getElementById("galleryStory").value.trim(),
        photos: readPhotosFromDom(),
        testimonials: readTestimonialsFromDom(),
        highlights: readHighlightsFromDom(),
    };
    if (btn)
        btn.disabled = true;
    if (status)
        status.textContent = "Saving…";
    try {
        const res = await fetch(`${API_BASE_URL}/admin/travel-gallery/${encodeURIComponent(destId)}`, {
            method: "PUT",
            headers: boundAuthHeaders,
            body: JSON.stringify(body),
        });
        if (!res.ok)
            throw new Error(await parseError(res));
        const data = (await res.json());
        if (data.destination) {
            const idx = galleryDestinations.findIndex((d) => d.id === destId);
            if (idx >= 0)
                galleryDestinations[idx] = data.destination;
        }
        if (status)
            status.textContent = "Saved — live on Travel Gallery page.";
    }
    catch (err) {
        window.alert(err instanceof Error ? err.message : "Save failed");
        if (status)
            status.textContent = "";
    }
    finally {
        if (btn)
            btn.disabled = false;
    }
}
function populateGallerySelect() {
    const select = document.getElementById("galleryDestSelect");
    if (!select)
        return;
    select.innerHTML = galleryDestinations
        .map((d) => `<option value="${escapeHtml(d.id)}" ${d.id === activeGalleryId ? "selected" : ""}>${escapeHtml(d.state)} (${escapeHtml(d.status === "completed" ? "completed" : "coming soon")})</option>`)
        .join("");
}
function selectGalleryDestination(id) {
    activeGalleryId = id;
    const dest = galleryDestinations.find((d) => d.id === id);
    if (!dest)
        return;
    renderGalleryEditor(dest);
}
export async function loadAdminGalleryTab(authHeaders) {
    boundAuthHeaders = authHeaders;
    try {
        galleryDestinations = await fetchGalleryList(authHeaders);
    }
    catch (err) {
        window.alert(err instanceof Error ? err.message : "Could not load Travel Gallery");
        return;
    }
    if (!galleryDestinations.length) {
        const root = getEditorRoot();
        if (root) {
            root.hidden = false;
            root.innerHTML = `<p class="form-hint">No destinations yet. Restart the backend to seed the gallery database.</p>`;
        }
        return;
    }
    if (!activeGalleryId)
        activeGalleryId = galleryDestinations[0]?.id ?? "";
    populateGallerySelect();
    selectGalleryDestination(activeGalleryId);
}
export function initAdminGallery(authHeaders) {
    const select = document.getElementById("galleryDestSelect");
    select?.addEventListener("change", () => {
        const id = select.value;
        if (id)
            selectGalleryDestination(id);
    });
    void loadAdminGalleryTab(authHeaders);
}
