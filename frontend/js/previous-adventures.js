import { galleryToJsonLd, setJsonLd, setPageSeo } from "./seo.js?v=20261125171901";
import { INDIA_MAP_VIEWBOX, mountIndiaMap, pinToPercent, setHighlightedState } from "./india-map.js?v=20261125171901";
import { getAdventureById, getGalleryHeroImage, getGalleryMapPin, loadTravelGalleryFromApi, PREVIOUS_ADVENTURES, } from "./previous-adventures-data.js?v=20261125171901";
import { updateHeaderAuth } from "./config.js?v=20261125171901";
import { districtFromTarget, getStateMapMeta, loadStateMapManifest, loadStateMapSvg, markDistricts, mountStateMap, projectLatLng, } from "./state-maps.js?v=20261125171901";
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
let activeAdventureId = null;
let lightboxPhotos = [];
let lightboxIndex = 0;
let indiaSvg = null;
let reviewPageIndex = 0;
let reviewPageCount = 0;
let reviewBookOpen = false;
let zoomedId = null;
let activePlaceKey = null;
let activeDistrictId = null;
let stateMeta = null;
let stateMapSvg = null;
let zoomToken = 0;
let clipTimer = 0;
function statItem(icon, label) {
    return `
    <div class="adv-stat-item">
      <span class="adv-stat-icon" aria-hidden="true">${icon}</span>
      <span class="adv-stat-label">${escapeHtml(label)}</span>
    </div>`;
}
function renderReviewBook(testimonials) {
    if (!testimonials.length)
        return "";
    const sheets = testimonials
        .map((t, i) => {
        const avatar = t.avatar
            ? `<img class="adv-testimonial-avatar" src="${escapeHtml(t.avatar)}" alt="" loading="lazy" />`
            : `<span class="adv-testimonial-avatar adv-testimonial-avatar--initial" aria-hidden="true">${escapeHtml(t.name.charAt(0))}</span>`;
        return `
        <article class="adv-review-book-sheet" data-review-index="${i}">
          <p class="adv-review-book-sheet-no" aria-hidden="true">— ${i + 1} —</p>
          <blockquote class="adv-review-book-quote">
            <span class="adv-review-book-quote-mark" aria-hidden="true">“</span>
            <p>${escapeHtml(t.quote)}</p>
          </blockquote>
          <footer class="adv-review-book-byline">${avatar}<span>— ${escapeHtml(t.name)}</span></footer>
        </article>`;
    })
        .join("");
    return `
    <section class="adv-detail-section adv-detail-section--stories">
      <h4 class="adv-section-title">Traveler Stories</h4>
      <div class="adv-review-book" id="advReviewBook" role="group" aria-label="Traveler review journal" tabindex="0">
        <button type="button" class="adv-diary-closed" id="advDiaryClosed" aria-label="Open traveler reviews diary">
          <span class="adv-diary-closed-cover">
            <svg class="adv-diary-cover-map" viewBox="0 0 120 60" aria-hidden="true">
              <ellipse cx="60" cy="32" rx="52" ry="24" fill="currentColor" opacity="0.35"/>
              <path d="M18 28c8-6 18-8 28-6 10 2 20 0 28-4 8 4 12 12 10 20-6 2-14 4-22 4s-18-2-28-6c-4-4-6-10-4-14z" fill="currentColor" opacity="0.5"/>
            </svg>
            <span class="adv-diary-closed-label">Reviews</span>
            <span class="adv-diary-clasp" aria-hidden="true"></span>
            <span class="adv-diary-closed-edge" aria-hidden="true"></span>
          </span>
          <span class="adv-diary-closed-hint">${testimonials.length} ${testimonials.length === 1 ? "story" : "stories"} inside · Click to open</span>
        </button>

        <div class="adv-diary-open" id="advDiaryOpen" hidden>
          <div class="adv-diary adv-diary--open">
            <div class="adv-diary-spine adv-diary-spine--open" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
            <div class="adv-diary-spread">
              <div class="adv-diary-leaf" id="advReviewLeaf">
                <div class="adv-diary-paper-edge" aria-hidden="true"></div>
                <button type="button" class="adv-review-book-hit adv-review-book-hit--prev" id="advReviewHitPrev" aria-label="Previous review or close diary"></button>
                <div class="adv-review-book-viewport">
                  <div class="adv-review-book-track" id="advReviewTrack">${sheets}</div>
                </div>
                <button type="button" class="adv-review-book-hit adv-review-book-hit--next" id="advReviewHitNext" aria-label="Next review"></button>
              </div>
              <div class="adv-diary-page-stack" aria-hidden="true"></div>
            </div>
          </div>
          <footer class="adv-review-book-foot">
            <button type="button" class="adv-diary-close-btn" id="advDiaryClose">Close diary</button>
            <span class="adv-review-book-counter" id="advReviewCounter">1 / ${testimonials.length}</span>
            <span class="adv-review-book-tip">Click page to turn</span>
          </footer>
        </div>
      </div>
    </section>`;
}
function renderDetailContent(adv) {
    const stats = [];
    if (adv.dates)
        stats.push(statItem("📅", adv.dates));
    if (adv.travelers)
        stats.push(statItem("👥", `${adv.travelers} Travelers`));
    if (adv.days)
        stats.push(statItem("🕐", `${adv.days} Days`));
    if (adv.photoCountLabel)
        stats.push(statItem("📷", `${adv.photoCountLabel} Photos`));
    const highlights = adv.highlights && adv.highlights.length
        ? `<section class="adv-detail-section adv-detail-section--highlights">
          <h4 class="adv-section-title">Highlights</h4>
          <div class="adv-highlights">
            ${adv.highlights
            .map((h) => `
              <figure class="adv-highlight-card">
                <img src="${escapeHtml(h.image)}" alt="${escapeHtml(h.title)}" loading="lazy" decoding="async" />
                <figcaption>${escapeHtml(h.title)}</figcaption>
              </figure>`)
            .join("")}
          </div>
        </section>`
        : "";
    const reviewBook = adv.testimonials?.length ? renderReviewBook(adv.testimonials) : "";
    const story = adv.story
        ? `<blockquote class="adv-story">
        <span class="adv-story-mark" aria-hidden="true">“</span>
        <p>${escapeHtml(adv.story)}</p>
      </blockquote>`
        : "";
    const hasReelLink = !!adv.reelUrl && /^https?:\/\//i.test(adv.reelUrl.trim());
    const reelInner = `<img class="adv-reel-bg" src="${escapeHtml(getGalleryHeroImage(adv))}" alt="" loading="lazy" decoding="async" />
      <span class="adv-reel-play" aria-hidden="true">▶</span>
      <span class="adv-reel-cap">Watch Trip Reel<small>${escapeHtml(adv.title)}</small></span>`;
    const reelSection = `<section class="adv-detail-section adv-detail-section--reel">
      <h4 class="adv-section-title">Trip Reel</h4>
      ${hasReelLink
        ? `<a class="adv-reel-card" href="${escapeHtml(adv.reelUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Watch trip reel">${reelInner}</a>`
        : `<button type="button" class="adv-reel-card" id="advWatchReel" aria-label="Watch trip reel">${reelInner}</button>`}
    </section>`;
    reviewPageCount = adv.testimonials?.length ?? 0;
    reviewPageIndex = 0;
    return `
    <header class="adv-detail-head">
      <h2 class="adv-detail-title" id="advDetailTitle">${escapeHtml(adv.title)}</h2>
      <span class="adv-completed-stamp" aria-hidden="true">Completed</span>
    </header>
    ${stats.length ? `<div class="adv-stats">${stats.join("")}</div>` : ""}
    <div class="adv-hero-wrap">
      <img class="adv-hero-img" src="${escapeHtml(getGalleryHeroImage(adv))}" alt="${escapeHtml(adv.title)} — Wonder Baboon group photo" />
    </div>
    ${story}
    ${highlights}
    ${reelSection}
    ${reviewBook}
    <div class="adv-detail-actions">
      <button type="button" class="adv-link-memories" id="advViewAllPhotos" ${adv.photos.length < 2 ? "hidden" : ""}>View All Memories →</button>
    </div>
  `;
}
function renderComingSoon(adv) {
    return `
    <header class="adv-detail-head">
      <h2 class="adv-detail-title" id="advDetailTitle">${escapeHtml(adv.title)}</h2>
    </header>
    <div class="adv-coming-soon-body">
      <img src="${escapeHtml(getGalleryHeroImage(adv))}" alt="" class="adv-coming-soon-img" loading="lazy" />
      <p class="adv-coming-soon-label">Coming Soon</p>
      <p>We're still collecting stories from ${escapeHtml(adv.state)}. Join an upcoming trip and help us fill this pin.</p>
      <a class="adv-btn-reel" href="/#trips">See upcoming trips</a>
    </div>
  `;
}
function pinSubtitle(adv) {
    if (adv.pinSubtitle)
        return adv.pinSubtitle;
    return adv.status === "completed" ? "Completed" : "Coming Soon";
}
const PIN_SHORT_NAMES = {
    himachal: "Himachal",
    uttarakhand: "Uttarakhand",
    nepal: "Nepal",
    banaras: "Banaras",
    rajasthan: "Rajasthan",
    "north-east": "North East",
    goa: "Goa",
    karnataka: "Karnataka",
    kerala: "Kerala",
};
const PIN_LABEL_PLACEMENT = {
    himachal: "adv-map-pin--tag-left",
    uttarakhand: "adv-map-pin--tag-below",
    nepal: "adv-map-pin--tag-right",
    banaras: "adv-map-pin--tag-below",
};
function pinShortState(adv) {
    return PIN_SHORT_NAMES[adv.id] ?? adv.state;
}
function setPinActive(id) {
    document.querySelectorAll(".adv-map-pin, .adv-pin-chip").forEach((el) => {
        const on = el.dataset.dest === id;
        el.classList.toggle("is-active", on);
        if (el.classList.contains("adv-map-pin")) {
            el.setAttribute("aria-pressed", on ? "true" : "false");
        }
    });
    const adv = id ? getAdventureById(id) : undefined;
    setHighlightedState(indiaSvg, adv?.svgStateId ?? null);
}
function isDesktopLayout() {
    return window.matchMedia("(min-width: 900px)").matches;
}
/** Black dashed curve from active pin toward the journal card (desktop only) */
function drawPinToCardLine(activeId) {
    if (!isDesktopLayout()) {
        const svg = document.getElementById("advTravelRoutes");
        if (svg)
            svg.innerHTML = "";
        return;
    }
    const svg = document.getElementById("advTravelRoutes");
    if (!svg)
        return;
    if (!activeId) {
        svg.innerHTML = "";
        return;
    }
    const adv = getAdventureById(activeId);
    if (!adv)
        return;
    const { x, y } = getGalleryMapPin(adv);
    const endX = INDIA_MAP_VIEWBOX.width - 12;
    const endY = Math.max(40, y - 40);
    const cx = x + (endX - x) * 0.55;
    const cy = y - 90;
    svg.setAttribute("viewBox", `0 0 ${INDIA_MAP_VIEWBOX.width} ${INDIA_MAP_VIEWBOX.height}`);
    svg.innerHTML = `
    <defs>
      <marker id="advArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#3d2e1f"/>
      </marker>
    </defs>
    <path d="M ${x} ${y} Q ${cx} ${cy} ${endX} ${endY}" marker-end="url(#advArrow)"/>
  `;
}
function openDetail(adv) {
    activeAdventureId = adv.id;
    setPinActive(adv.id);
    const panel = document.getElementById("advDetailPanel");
    const backdrop = document.getElementById("advDetailBackdrop");
    const inner = document.getElementById("advDetailInner");
    if (!panel || !inner)
        return;
    inner.innerHTML = adv.status === "completed" ? renderDetailContent(adv) : renderComingSoon(adv);
    panel.hidden = false;
    if (!isDesktopLayout())
        backdrop?.removeAttribute("hidden");
    document.body.classList.add("adv-detail-open");
    if (!isDesktopLayout()) {
        document.getElementById("advMobileHint")?.setAttribute("hidden", "");
    }
    drawPinToCardLine(adv.id);
    const url = new URL(window.location.href);
    url.searchParams.set("dest", adv.id);
    history.replaceState(null, "", url.pathname + url.search);
    bindDetailEvents(adv);
}
function closeDetail() {
    activeAdventureId = null;
    activePlaceKey = null;
    document.querySelectorAll(".adv-zoom-card, .adv-place-pin").forEach((el) => el.classList.remove("is-active"));
    setPinActive(zoomedId);
    drawPinToCardLine(null);
    const panel = document.getElementById("advDetailPanel");
    const backdrop = document.getElementById("advDetailBackdrop");
    panel?.setAttribute("hidden", "");
    backdrop?.setAttribute("hidden", "");
    document.body.classList.remove("adv-detail-open");
    document.getElementById("advMobileHint")?.removeAttribute("hidden");
    const url = new URL(window.location.href);
    if (zoomedId)
        url.searchParams.set("dest", zoomedId);
    else
        url.searchParams.delete("dest");
    if (activeDistrictId)
        url.searchParams.set("district", activeDistrictId);
    else
        url.searchParams.delete("district");
    url.searchParams.delete("place");
    url.searchParams.delete("trip");
    const qs = url.searchParams.toString();
    history.replaceState(null, "", url.pathname + (qs ? `?${qs}` : ""));
}
function openReviewBook() {
    const book = document.getElementById("advReviewBook");
    const open = document.getElementById("advDiaryOpen");
    if (!book || !open)
        return;
    reviewBookOpen = true;
    book.classList.add("is-open");
    open.hidden = false;
    setReviewPage(0);
}
function closeReviewBook() {
    const book = document.getElementById("advReviewBook");
    const open = document.getElementById("advDiaryOpen");
    if (!book || !open)
        return;
    reviewBookOpen = false;
    book.classList.remove("is-open");
    open.hidden = true;
    reviewPageIndex = 0;
    const track = document.getElementById("advReviewTrack");
    if (track)
        track.style.transform = "translateX(0)";
}
function setReviewPage(index) {
    if (reviewPageCount < 1)
        return;
    reviewPageIndex = Math.max(0, Math.min(index, reviewPageCount - 1));
    const track = document.getElementById("advReviewTrack");
    const leaf = document.getElementById("advReviewLeaf");
    if (track)
        track.style.transform = `translateX(-${reviewPageIndex * 100}%)`;
    const counter = document.getElementById("advReviewCounter");
    if (counter)
        counter.textContent = `${reviewPageIndex + 1} / ${reviewPageCount}`;
    const atEnd = reviewPageIndex >= reviewPageCount - 1;
    document.getElementById("advReviewHitNext")?.toggleAttribute("disabled", atEnd);
    const tip = document.querySelector(".adv-review-book-tip");
    if (tip) {
        tip.textContent =
            reviewPageIndex >= reviewPageCount - 1 ? "Last page · Close to fold shut" : "Click page to turn";
    }
    leaf?.classList.remove("adv-diary-leaf--turn");
    void leaf?.offsetWidth;
    leaf?.classList.add("adv-diary-leaf--turn");
}
function bindReviewBook() {
    reviewBookOpen = false;
    reviewPageIndex = 0;
    const book = document.getElementById("advReviewBook");
    const open = document.getElementById("advDiaryOpen");
    if (open)
        open.hidden = true;
    book?.classList.remove("is-open");
    document.getElementById("advDiaryClosed")?.addEventListener("click", openReviewBook);
    document.getElementById("advDiaryClose")?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeReviewBook();
    });
    const goPrev = (e) => {
        e?.stopPropagation();
        if (reviewPageIndex <= 0) {
            closeReviewBook();
            return;
        }
        setReviewPage(reviewPageIndex - 1);
    };
    const goNext = (e) => {
        e?.stopPropagation();
        if (reviewPageIndex >= reviewPageCount - 1)
            return;
        setReviewPage(reviewPageIndex + 1);
    };
    document.getElementById("advReviewHitPrev")?.addEventListener("click", goPrev);
    document.getElementById("advReviewHitNext")?.addEventListener("click", goNext);
    document.getElementById("advReviewLeaf")?.addEventListener("click", (e) => {
        if (!reviewBookOpen)
            return;
        if (e.target.closest("button"))
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < rect.width * 0.32)
            goPrev(e);
        else
            goNext(e);
    });
    book?.addEventListener("keydown", (e) => {
        if (!reviewBookOpen) {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openReviewBook();
            }
            return;
        }
        if (e.key === "ArrowLeft")
            goPrev();
        if (e.key === "ArrowRight")
            goNext();
        if (e.key === "Escape")
            closeReviewBook();
    });
    if (reviewPageCount >= 1) {
        const track = document.getElementById("advReviewTrack");
        if (track)
            track.style.transform = "translateX(0)";
    }
}
function bindDetailEvents(adv) {
    bindReviewBook();
    document.getElementById("advViewAllPhotos")?.addEventListener("click", () => {
        if (adv.photos.length)
            openLightbox(adv.photos, 0);
    });
    document.getElementById("advWatchReel")?.addEventListener("click", () => {
        if (adv.videos?.length) {
            document.querySelector(".adv-video-card video")?.play();
            return;
        }
        if (adv.photos.length)
            openLightbox(adv.photos, 0);
    });
}
function openLightbox(photos, start) {
    lightboxPhotos = photos;
    lightboxIndex = Math.max(0, Math.min(start, photos.length - 1));
    let lb = document.getElementById("advLightbox");
    if (!lb) {
        lb = document.createElement("div");
        lb.id = "advLightbox";
        lb.className = "adv-lightbox";
        lb.innerHTML = `
      <button type="button" class="adv-lightbox-close" aria-label="Close gallery">&times;</button>
      <button type="button" class="adv-lightbox-prev" aria-label="Previous photo">‹</button>
      <img class="adv-lightbox-img" alt="" />
      <button type="button" class="adv-lightbox-next" aria-label="Next photo">›</button>
      <p class="adv-lightbox-counter"></p>
    `;
        document.body.appendChild(lb);
        lb.querySelector(".adv-lightbox-close")?.addEventListener("click", closeLightbox);
        lb.querySelector(".adv-lightbox-prev")?.addEventListener("click", () => stepLightbox(-1));
        lb.querySelector(".adv-lightbox-next")?.addEventListener("click", () => stepLightbox(1));
        lb.addEventListener("click", (e) => {
            if (e.target === lb)
                closeLightbox();
        });
        document.addEventListener("keydown", onLightboxKey);
    }
    updateLightbox();
    lb.classList.add("is-open");
    document.body.classList.add("adv-lightbox-open");
}
function closeLightbox() {
    document.getElementById("advLightbox")?.classList.remove("is-open");
    document.body.classList.remove("adv-lightbox-open");
}
function stepLightbox(delta) {
    if (!lightboxPhotos.length)
        return;
    lightboxIndex = (lightboxIndex + delta + lightboxPhotos.length) % lightboxPhotos.length;
    updateLightbox();
}
function updateLightbox() {
    const lb = document.getElementById("advLightbox");
    const img = lb?.querySelector(".adv-lightbox-img");
    const counter = lb?.querySelector(".adv-lightbox-counter");
    if (!img)
        return;
    img.src = lightboxPhotos[lightboxIndex] ?? "";
    if (counter)
        counter.textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
}
function onLightboxKey(event) {
    if (!document.body.classList.contains("adv-lightbox-open"))
        return;
    if (event.key === "Escape")
        closeLightbox();
    if (event.key === "ArrowLeft")
        stepLightbox(-1);
    if (event.key === "ArrowRight")
        stepLightbox(1);
}
function hasZoomableState(adv) {
    return Boolean(adv.svgStateId && indiaSvg?.querySelector(`#${adv.svgStateId}`));
}
function selectDestination(id) {
    const adv = getAdventureById(id);
    if (!adv)
        return;
    if (hasZoomableState(adv)) {
        if (zoomedId === id)
            zoomOut();
        else
            zoomToState(adv);
        return;
    }
    if (zoomedId)
        zoomOut();
    if (activeAdventureId === id) {
        closeDetail();
        return;
    }
    openDetail(adv);
}
function renderMapPins() {
    const wrap = document.getElementById("advMapPins");
    if (!wrap)
        return;
    wrap.innerHTML = PREVIOUS_ADVENTURES.map((adv) => {
        const completed = adv.status === "completed";
        const sub = pinSubtitle(adv);
        const pin = getGalleryMapPin(adv);
        const pos = pinToPercent(pin.x, pin.y);
        const placement = PIN_LABEL_PLACEMENT[adv.id] ?? "";
        const shortState = pinShortState(adv);
        return `
      <button
        type="button"
        class="adv-map-pin ${completed ? "adv-map-pin--done" : "adv-map-pin--soon"} ${placement}"
        style="left:${pos.left}%;top:${pos.top}%"
        data-dest="${escapeHtml(adv.id)}"
        aria-label="${escapeHtml(`${adv.state}, ${sub}`)}"
        aria-pressed="false"
      >
        <span class="adv-pin-marker" aria-hidden="true"></span>
        <span class="adv-pin-tag">
          <strong class="adv-pin-tag-name">${escapeHtml(shortState)}</strong>
          <em>${escapeHtml(sub)}</em>
        </span>
      </button>`;
    }).join("");
    wrap.querySelectorAll(".adv-map-pin").forEach((pin) => {
        pin.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = pin.dataset.dest;
            if (id)
                selectDestination(id);
        });
    });
}
function renderPinChips() {
    const nav = document.getElementById("advPinChips");
    if (!nav)
        return;
    nav.innerHTML = PREVIOUS_ADVENTURES.map((adv) => {
        const done = adv.status === "completed";
        return `
      <button type="button" class="adv-pin-chip ${done ? "adv-pin-chip--done" : "adv-pin-chip--soon"}" data-dest="${escapeHtml(adv.id)}">
        ${escapeHtml(adv.state)}
      </button>`;
    }).join("");
    nav.querySelectorAll(".adv-pin-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
            const id = chip.dataset.dest;
            if (id)
                selectDestination(id);
        });
    });
}
function initDefaultView() {
    const dest = new URLSearchParams(window.location.search).get("dest");
    const adv = dest ? getAdventureById(dest) : isDesktopLayout() ? getAdventureById("himachal") : undefined;
    // States with places are opened by the zoom flow once the map is ready (see initMap).
    if (adv && !adv.svgStateId)
        openDetail(adv);
}
document.addEventListener("DOMContentLoaded", () => {
    updateHeaderAuth();
    bindChrome();
    void (async () => {
        await loadTravelGalleryFromApi();
        setJsonLd("ld-gallery", galleryToJsonLd(PREVIOUS_ADVENTURES));
        renderPinChips();
        initDefaultView();
        await initMap().then(() => {
            if (activeAdventureId)
                drawPinToCardLine(activeAdventureId);
        });
    })();
});
function bindChrome() {
    document.getElementById("advDetailClose")?.addEventListener("click", closeDetail);
    document.getElementById("advDetailBackdrop")?.addEventListener("click", closeDetail);
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape")
            return;
        if (document.body.classList.contains("adv-detail-open")) {
            if (document.body.classList.contains("adv-lightbox-open"))
                closeLightbox();
            else
                closeDetail();
        }
        else if (activeDistrictId) {
            selectDistrict(null);
        }
        else if (zoomedId) {
            zoomOut();
        }
    });
    window.addEventListener("resize", () => {
        if (zoomedId)
            relayoutZoom();
    });
}
async function initMap() {
    const host = document.getElementById("advIndiaMapHost");
    const loading = document.getElementById("advMapLoading");
    const frame = document.getElementById("advMapFrame");
    if (!host)
        return;
    try {
        indiaSvg = await mountIndiaMap(host);
        indiaSvg?.querySelectorAll(".adv-india-state").forEach((path) => {
            const adv = PREVIOUS_ADVENTURES.find((a) => a.svgStateId === path.id);
            if (!adv)
                return;
            path.style.cursor = "pointer";
            path.addEventListener("click", () => selectDestination(adv.id));
        });
        loading?.remove();
        frame?.removeAttribute("hidden");
        renderMapPins();
        if (activeAdventureId)
            drawPinToCardLine(activeAdventureId);
        prefetchStateMaps();
        const params = new URLSearchParams(window.location.search);
        const wanted = params.get("dest");
        const target = wanted ? getAdventureById(wanted) : undefined;
        if (target && hasZoomableState(target)) {
            zoomToState(target, true, {
                district: params.get("district"),
                place: params.get("place"),
                trip: params.get("trip"),
            });
        }
    }
    catch (error) {
        console.error("Travel gallery map error", error);
        if (loading)
            loading.textContent = "Map could not load. Use the destination buttons below.";
    }
}
/* ───────────── India → State → District → Trip ─────────────
 * Every state zooms (visited or coming soon). The India SVG zooms onto the state, then crossfades into the
 * district map (assets/maps/<code>.svg) with a pin per place. Click a district to see its places and trips.
 */
const MAP_TOP_RESERVE = 58;
const stateBottomReserve = () => (isDesktopLayout() ? 200 : 176);
function frameSize() {
    const frame = document.getElementById("advMapFrame");
    return { w: frame?.clientWidth || 600, h: frame?.clientHeight || 700 };
}
/** Free area of the frame (px) that the state / district map should fill. */
function mapBox() {
    const { w, h } = frameSize();
    const side = 10;
    return { x: side, y: MAP_TOP_RESERVE, w: Math.max(120, w - side * 2), h: Math.max(120, h - MAP_TOP_RESERVE - stateBottomReserve()) };
}
function zoomTransformFor(path) {
    const { w: W, h: H } = frameSize();
    const box = path.getBBox();
    const bx = (box.x / INDIA_MAP_VIEWBOX.width) * W;
    const by = (box.y / INDIA_MAP_VIEWBOX.height) * H;
    const bw = (box.width / INDIA_MAP_VIEWBOX.width) * W;
    const bh = (box.height / INDIA_MAP_VIEWBOX.height) * H;
    const target = mapBox();
    const scale = Math.max(1.4, Math.min(14, target.w / bw, target.h / bh)) * 0.96;
    const tx = target.x + target.w / 2 - scale * (bx + bw / 2);
    const ty = target.y + target.h / 2 - scale * (by + bh / 2);
    return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale.toFixed(3)})`;
}
function currentAdventure() {
    return zoomedId ? getAdventureById(zoomedId) : undefined;
}
function tripsIn(place) {
    return place.visits.length;
}
function tripLabel(v) {
    return v.label || v.dates || "Trip";
}
function placeCover(place) {
    return place.heroImage || place.visits.flatMap((v) => v.photos ?? [])[0] || "";
}
function districtCounts(adv) {
    const out = {};
    (adv.places ?? []).forEach((p) => {
        if (p.districtId)
            out[p.districtId] = (out[p.districtId] ?? 0) + tripsIn(p);
    });
    return out;
}
function districtLabel(id) {
    if (!id)
        return "";
    return stateMeta?.districts.find((d) => d.id === id)?.name ?? id;
}
const BASE_TITLE = document.title;
const BASE_DESCRIPTION = document.querySelector('meta[name="description"]')?.content ?? "";
/** Title + description follow what is on screen (state → district → place), the canonical URL stays the gallery. */
function syncGallerySeo(params) {
    const adv = params.dest ? getAdventureById(params.dest) : undefined;
    if (!adv) {
        setPageSeo(BASE_TITLE, BASE_DESCRIPTION);
        return;
    }
    const place = params.place ? adv.places?.find((p) => p.id === params.place) : undefined;
    const district = (place?.districtName || districtLabel(params.district)) ?? "";
    if (place) {
        const where = [place.area, district, adv.state].filter(Boolean).join(", ");
        const lead = (place.description || place.tagline || "").trim().replace(/[.\s]+$/, "");
        const text = `${lead ? `${lead}. ` : ""}Photos, stories and traveler reviews from our group trips to ${place.name} (${where}).`;
        setPageSeo(`${place.name}, ${adv.state}: Trip Photos & Reviews | Wonder Baboon`, text);
    }
    else if (district) {
        const names = (adv.places ?? []).filter((p) => p.districtId === params.district).map((p) => p.name);
        setPageSeo(`${district}, ${adv.state}: Places & Trips | Wonder Baboon`, names.length ? `Places we have travelled to in ${district} district, ${adv.state}: ${names.join(", ")}. See photos, stories and reviews.` : `Explore ${district} district in ${adv.state} on the Wonder Baboon travel gallery map.`);
    }
    else {
        const names = (adv.places ?? []).map((p) => p.name);
        setPageSeo(`${adv.state} Group Trips: Places, Photos & Stories | Wonder Baboon`, names.length ? `Wonder Baboon group trips in ${adv.state}: ${names.join(", ")}. District map, trip photos and traveler reviews.` : `${adv.state} on the Wonder Baboon travel gallery — our trips and stories from the region.`);
    }
}
function setUrlParams(params) {
    syncGallerySeo(params);
    const url = new URL(window.location.href);
    Object.entries(params).forEach(([k, v]) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k)));
    const qs = url.searchParams.toString();
    history.replaceState(null, "", url.pathname + (qs ? `?${qs}` : ""));
}
function ensureStateLayer() {
    const frame = document.getElementById("advMapFrame");
    if (!frame)
        return null;
    let layer = document.getElementById("advStateMap");
    if (!layer) {
        layer = document.createElement("div");
        layer.id = "advStateMap";
        layer.className = "adv-state-map";
        layer.innerHTML = `<div class="adv-state-map-inner" id="advStateMapInner"></div>`;
        frame.insertBefore(layer, document.getElementById("advZoomUi"));
    }
    return layer;
}
function zoomToState(adv, instant = false, restore) {
    const path = adv.svgStateId ? indiaSvg?.querySelector(`#${adv.svgStateId}`) : null;
    const zoom = document.getElementById("advMapZoom");
    const frame = document.getElementById("advMapFrame");
    if (!path || !zoom || !frame)
        return;
    if (activeAdventureId)
        closeDetail();
    const token = ++zoomToken;
    zoomedId = adv.id;
    activeDistrictId = null;
    activePlaceKey = null;
    stateMeta = null;
    stateMapSvg = null;
    setPinActive(adv.id);
    drawPinToCardLine(null);
    // drop whatever district map was showing (switching state, or re-entering) so it can never flash in the wrong place
    const oldInner = document.getElementById("advStateMapInner");
    if (oldInner) {
        oldInner.innerHTML = "";
        oldInner.style.transform = "";
        Object.assign(oldInner.style, { width: "0px", height: "0px" });
    }
    zoom.classList.toggle("is-instant", instant);
    frame.classList.remove("is-districts");
    frame.classList.add("is-zoomed", "is-clip");
    window.clearTimeout(clipTimer);
    zoom.style.transform = zoomTransformFor(path);
    renderZoomUi(adv);
    setUrlParams({ dest: adv.id, district: null, place: null, trip: null });
    void (async () => {
        let meta = null;
        try {
            meta = await getStateMapMeta(adv.svgStateId);
            if (token !== zoomToken || !meta)
                return;
            const layer = ensureStateLayer();
            const inner = document.getElementById("advStateMapInner");
            if (!layer || !inner)
                return;
            stateMapSvg = await mountStateMap(inner, meta);
            if (token !== zoomToken || !stateMapSvg)
                return;
            stateMeta = meta;
            decorateStateMap(adv, meta, inner);
            relayoutZoom();
            layer.classList.toggle("is-instant", instant);
            frame.classList.add("is-districts");
            renderZoomUi(adv);
        }
        catch {
            /* no district map — the zoomed state outline + list below still works */
        }
        if (token !== zoomToken)
            return;
        if (restore?.district && stateMeta)
            selectDistrict(restore.district);
        const place = restore?.place ? adv.places?.find((p) => p.id === restore.place) : undefined;
        if (place)
            openPlace(adv, place, restore?.trip ?? null);
    })();
}
/** District tooltips, labels, click handling and place pins. */
function decorateStateMap(adv, meta, inner) {
    const svg = stateMapSvg;
    if (!svg)
        return;
    svg.querySelectorAll(".wb-districts [data-district]").forEach((path) => {
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = path.getAttribute("data-name") ?? "";
        path.appendChild(title);
    });
    if (meta.districts.length <= 30) {
        const fontSize = meta.w / (meta.districts.length > 14 ? 78 : 56);
        const labels = document.createElementNS("http://www.w3.org/2000/svg", "g");
        labels.setAttribute("class", "wb-labels");
        meta.districts.forEach((d) => {
            const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
            t.setAttribute("x", String(d.cx));
            t.setAttribute("y", String(d.cy));
            t.setAttribute("font-size", fontSize.toFixed(1));
            t.setAttribute("class", "wb-district-label");
            t.textContent = d.name;
            labels.appendChild(t);
        });
        svg.appendChild(labels);
    }
    svg.addEventListener("click", (event) => {
        const id = districtFromTarget(event.target);
        if (id)
            selectDistrict(activeDistrictId === id ? null : id);
    });
    markDistricts(svg, districtCounts(adv), null);
    inner.querySelector(".adv-state-pins")?.remove();
    const pins = document.createElement("div");
    pins.className = "adv-state-pins";
    // Nearby pins would hide each other's names: put the tag above the first, then to the right / left of its neighbours.
    const placed = [];
    const near = meta.w * 0.07;
    pins.innerHTML = (adv.places ?? [])
        .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
        .map((p) => {
        const pt = projectLatLng(meta, p.lat, p.lng);
        const crowd = placed.filter((q) => Math.hypot(q.x - pt.x, q.y - pt.y) < near).length;
        placed.push(pt);
        const side = crowd === 0 ? "" : crowd % 2 === 1 ? " adv-place-pin--right" : " adv-place-pin--left";
        return `<button type="button" class="adv-place-pin${side}" data-place="${escapeHtml(p.id)}"
          style="left:${((pt.x / meta.w) * 100).toFixed(2)}%;top:${((pt.y / meta.h) * 100).toFixed(2)}%"
          aria-label="${escapeHtml(p.name)}">
          <span class="adv-place-pin-marker" aria-hidden="true"></span>
          <span class="adv-place-pin-tag">${escapeHtml(p.name)}</span>
        </button>`;
    })
        .join("");
    inner.appendChild(pins);
    pins.querySelectorAll(".adv-place-pin").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const place = adv.places?.find((p) => p.id === btn.dataset.place);
            if (place)
                openPlace(adv, place, null);
        });
    });
}
/** Fit the district map into the free area; zoom further into the selected district. */
function relayoutZoom() {
    const adv = currentAdventure();
    const frame = document.getElementById("advMapFrame");
    const zoom = document.getElementById("advMapZoom");
    if (!adv || !frame || !zoom)
        return;
    const path = adv.svgStateId ? indiaSvg?.querySelector(`#${adv.svgStateId}`) : null;
    if (path) {
        const was = zoom.classList.contains("is-instant");
        zoom.classList.add("is-instant");
        zoom.style.transform = zoomTransformFor(path);
        if (!was)
            window.setTimeout(() => zoom.classList.remove("is-instant"), 60);
    }
    const inner = document.getElementById("advStateMapInner");
    if (!inner || !stateMeta || !stateMapSvg)
        return;
    const box = mapBox();
    const fit = Math.min(box.w / stateMeta.w, box.h / stateMeta.h);
    const iw = stateMeta.w * fit;
    const ih = stateMeta.h * fit;
    const left = box.x + (box.w - iw) / 2;
    const top = box.y + (box.h - ih) / 2;
    Object.assign(inner.style, { left: `${left}px`, top: `${top}px`, width: `${iw}px`, height: `${ih}px` });
    let transform = "";
    let z = 1;
    if (activeDistrictId) {
        const dpath = stateMapSvg.querySelector(`[data-district="${activeDistrictId}"]`);
        if (dpath) {
            const b = dpath.getBBox();
            const k = iw / stateMeta.w;
            const bw = b.width * k;
            const bh = b.height * k;
            z = Math.max(1, Math.min(3.2, (box.w / bw) * 0.8, (box.h / bh) * 0.8));
            const cx = (b.x + b.width / 2) * k;
            const cy = (b.y + b.height / 2) * k;
            const tx = box.x + box.w / 2 - left - z * cx;
            const ty = box.y + box.h / 2 - top - z * cy;
            transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${z.toFixed(3)})`;
        }
    }
    inner.style.setProperty("--z", String(z));
    inner.style.transform = transform;
}
function selectDistrict(id) {
    const adv = currentAdventure();
    if (!adv)
        return;
    if (activeAdventureId)
        closeDetail();
    activeDistrictId = id;
    if (stateMapSvg)
        markDistricts(stateMapSvg, districtCounts(adv), id);
    relayoutZoom();
    renderZoomUi(adv);
    setUrlParams({ dest: adv.id, district: id, place: null, trip: null });
}
function zoomOut() {
    if (activeAdventureId)
        closeDetail();
    zoomToken++;
    zoomedId = null;
    activeDistrictId = null;
    const zoom = document.getElementById("advMapZoom");
    const frame = document.getElementById("advMapFrame");
    const ui = document.getElementById("advZoomUi");
    zoom?.classList.remove("is-instant");
    if (zoom)
        zoom.style.transform = "";
    frame?.classList.remove("is-districts", "is-zoomed");
    const inner = document.getElementById("advStateMapInner");
    if (inner)
        inner.style.pointerEvents = "none";
    // keep clipping while the map animates back, then clean the district layer up
    window.clearTimeout(clipTimer);
    clipTimer = window.setTimeout(() => {
        if (zoomedId)
            return;
        frame?.classList.remove("is-clip");
        if (inner) {
            inner.innerHTML = "";
            inner.style.transform = "";
            inner.style.pointerEvents = "";
            Object.assign(inner.style, { width: "0px", height: "0px" });
        }
    }, 1000);
    stateMeta = null;
    stateMapSvg = null;
    if (ui) {
        ui.hidden = true;
        ui.innerHTML = "";
    }
    setPinActive(null);
    setUrlParams({ dest: null, district: null, place: null, trip: null });
}
function placeCardHtml(place) {
    const cover = placeCover(place);
    const sub = [place.area, `${tripsIn(place)} trip${tripsIn(place) === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
    const chips = place.visits
        .map((v) => `<button type="button" class="adv-trip-chip" data-place="${escapeHtml(place.id)}" data-trip="${escapeHtml(v.id)}">${escapeHtml(tripLabel(v))}</button>`)
        .join("");
    return `
    <article class="adv-zoom-card adv-zoom-card--place" data-place="${escapeHtml(place.id)}" tabindex="0">
      <span class="adv-zoom-card-img">${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" />` : ""}</span>
      <span class="adv-zoom-card-text">
        <strong>${escapeHtml(place.name)}</strong>
        <em>${escapeHtml(sub)}</em>
        <span class="adv-trip-chips">${chips}</span>
      </span>
    </article>`;
}
function renderZoomUi(adv) {
    const ui = document.getElementById("advZoomUi");
    if (!ui)
        return;
    const places = adv.places ?? [];
    const counts = districtCounts(adv);
    const crumbs = `
    <nav class="adv-crumbs" aria-label="Map level">
      <button type="button" class="adv-crumb-link" data-crumb="india">India</button>
      <span class="adv-crumb-sep" aria-hidden="true">›</span>
      ${activeDistrictId
        ? `<button type="button" class="adv-crumb-link" data-crumb="state">${escapeHtml(adv.state)}</button>
             <span class="adv-crumb-sep" aria-hidden="true">›</span>
             <span class="adv-crumb-current">${escapeHtml(districtLabel(activeDistrictId))}</span>`
        : `<span class="adv-crumb-current">${escapeHtml(adv.state)}</span>`}
    </nav>`;
    let strip = "";
    if (activeDistrictId) {
        const inDistrict = places.filter((p) => p.districtId === activeDistrictId);
        strip = inDistrict.length
            ? `<p class="adv-zoom-hint">${inDistrict.length} place${inDistrict.length === 1 ? "" : "s"} in ${escapeHtml(districtLabel(activeDistrictId))} — pick a trip to open it</p>
         <div class="adv-zoom-cards">${inDistrict.map(placeCardHtml).join("")}</div>`
            : `<div class="adv-zoom-soon"><strong>No trips in ${escapeHtml(districtLabel(activeDistrictId))} yet</strong>
         <p>We haven't explored this district together. Maybe on the next one.</p></div>`;
    }
    else if (!places.length) {
        strip = `<div class="adv-zoom-soon"><strong>${adv.status === "completed" ? "Stories on the way" : "Coming soon"}</strong>
      <p>We haven't taken a group to ${escapeHtml(adv.state)} yet. Join an upcoming trip and put the first pin here.</p>
      <a class="adv-btn-reel" href="/#trips">See upcoming trips</a></div>`;
    }
    else {
        const districts = Object.keys(counts);
        const cards = districts
            .map((id) => {
            const inD = places.filter((p) => p.districtId === id);
            const cover = placeCover(inD[0]);
            return `<button type="button" class="adv-zoom-card adv-zoom-card--district" data-district="${escapeHtml(id)}">
          <span class="adv-zoom-card-img">${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" />` : ""}</span>
          <span class="adv-zoom-card-text"><strong>${escapeHtml(districtLabel(id))}</strong>
          <em>${inD.length} place${inD.length === 1 ? "" : "s"} · ${counts[id]} trip${counts[id] === 1 ? "" : "s"}</em></span></button>`;
        })
            .join("");
        const loose = places.filter((p) => !p.districtId).map(placeCardHtml).join("");
        strip = `<p class="adv-zoom-hint">${stateMeta ? "Tap a district on the map, or pick one below" : "Pick a place below"}</p><div class="adv-zoom-cards">${cards}${loose}</div>`;
    }
    ui.innerHTML = `${crumbs}<div class="adv-zoom-strip">${strip}</div>`;
    ui.hidden = false;
    bindZoomUi(ui, adv);
}
function bindZoomUi(ui, adv) {
    ui.querySelectorAll("[data-crumb]").forEach((btn) => btn.addEventListener("click", () => (btn.dataset.crumb === "india" ? zoomOut() : selectDistrict(null))));
    ui.querySelectorAll(".adv-zoom-card--district").forEach((card) => card.addEventListener("click", () => selectDistrict(card.dataset.district ?? null)));
    ui.querySelectorAll(".adv-trip-chip").forEach((chip) => chip.addEventListener("click", (e) => {
        e.stopPropagation();
        const place = adv.places?.find((p) => p.id === chip.dataset.place);
        if (place)
            openPlace(adv, place, chip.dataset.trip ?? null);
    }));
    ui.querySelectorAll(".adv-zoom-card--place").forEach((card) => {
        const open = () => {
            const place = adv.places?.find((p) => p.id === card.dataset.place);
            if (place)
                openPlace(adv, place, null);
        };
        card.addEventListener("click", open);
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter")
                open();
        });
    });
}
/** Build the single-trip shape the journal renderer expects from one place (all trips, or one). */
function placeAsAdventure(adv, place, visitId) {
    const visits = visitId ? place.visits.filter((v) => v.id === visitId) : place.visits;
    const photos = visits.flatMap((v) => v.photos ?? []);
    const first = visits[0];
    const dates = visits.length === 1 ? first?.dates ?? "" : visits.length > 1 ? `${visits.length} trips` : "";
    return {
        ...adv,
        id: `${adv.id}:${place.id}`,
        title: place.name,
        status: "completed",
        tripLabel: place.tagline,
        tripMeta: first?.tripMeta,
        dates,
        travelers: visits.reduce((n, v) => n + (v.travelers ?? 0), 0),
        days: visits.length === 1 ? first?.days ?? 0 : 0,
        photoCountLabel: photos.length ? String(photos.length) : "",
        heroImage: place.heroImage || photos[0] || adv.heroImage,
        photos,
        highlights: visits.flatMap((v) => v.highlights ?? []),
        testimonials: visits.flatMap((v) => v.testimonials ?? []),
        story: (visitId ? first?.story : "") || place.description || first?.story || "",
        reelUrl: first?.reelUrl ?? "",
        videos: [],
    };
}
function renderVisitTabs(place, selected) {
    if (place.visits.length < 2)
        return "";
    const tab = (id, label) => `<button type="button" class="adv-visit-tab${id === selected ? " is-active" : ""}" data-visit="${escapeHtml(id ?? "")}">${escapeHtml(label)}</button>`;
    return `<div class="adv-visit-tabs" role="tablist" aria-label="Trips to ${escapeHtml(place.name)}">
    ${tab(null, "All trips")}
    ${place.visits.map((v) => tab(v.id, tripLabel(v))).join("")}
  </div>`;
}
function openPlace(adv, place, visitId = null) {
    const panel = document.getElementById("advDetailPanel");
    const backdrop = document.getElementById("advDetailBackdrop");
    const inner = document.getElementById("advDetailInner");
    if (!panel || !inner)
        return;
    // jump to the place's district first (this also closes any open journal)
    if (place.districtId && place.districtId !== activeDistrictId && stateMeta)
        selectDistrict(place.districtId);
    activeAdventureId = adv.id;
    activePlaceKey = `${adv.id}:${place.id}`;
    document.querySelectorAll(".adv-zoom-card--place, .adv-place-pin").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.place === place.id);
    });
    const synthetic = placeAsAdventure(adv, place, visitId);
    inner.innerHTML = renderDetailContent(synthetic);
    const head = inner.querySelector(".adv-detail-head");
    const trail = [adv.state, place.districtName || districtLabel(place.districtId), place.area].filter(Boolean).join(" › ");
    head?.insertAdjacentHTML("beforebegin", `<p class="adv-detail-crumb">${escapeHtml(trail)}</p>`);
    const tabs = renderVisitTabs(place, visitId);
    if (tabs)
        head?.insertAdjacentHTML("afterend", tabs);
    inner.querySelectorAll(".adv-visit-tab").forEach((btn) => {
        btn.addEventListener("click", () => openPlace(adv, place, btn.dataset.visit || null));
    });
    panel.hidden = false;
    if (!isDesktopLayout())
        backdrop?.removeAttribute("hidden");
    document.body.classList.add("adv-detail-open");
    document.getElementById("advMobileHint")?.setAttribute("hidden", "");
    inner.scrollTop = 0;
    setUrlParams({ dest: adv.id, district: place.districtId || null, place: place.id, trip: visitId });
    bindDetailEvents(synthetic);
}
/** Warm the district map for a state before it is clicked, so the zoom never waits on the network. */
function prefetchState(id) {
    const adv = id ? getAdventureById(id) : undefined;
    if (!adv?.svgStateId)
        return;
    void getStateMapMeta(adv.svgStateId).then((meta) => {
        if (meta)
            void loadStateMapSvg(meta).catch(() => undefined);
    });
}
function prefetchStateMaps() {
    void loadStateMapManifest();
    const handler = (e) => {
        const el = e.target.closest("[data-dest]");
        prefetchState(el?.dataset.dest);
    };
    ["pointerover", "focusin", "touchstart"].forEach((ev) => document.addEventListener(ev, handler, { passive: true }));
    // completed states are the likely first click: warm them right away, when the browser is idle
    const idle = window.requestIdleCallback ?? ((cb) => window.setTimeout(cb, 600));
    idle(() => PREVIOUS_ADVENTURES.filter((a) => a.status === "completed").forEach((a) => prefetchState(a.id)));
}
