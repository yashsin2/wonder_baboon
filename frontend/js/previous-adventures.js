import { INDIA_MAP_VIEWBOX, mountIndiaMap, pinToPercent, setHighlightedState } from "./india-map.js";
import { getAdventureById, getGalleryHeroImage, getGalleryMapPin, loadTravelGalleryFromApi, PREVIOUS_ADVENTURES, } from "./previous-adventures-data.js";
import { updateHeaderAuth } from "./config.js";
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
    const reelBtn = adv.reelUrl && adv.reelUrl.trim()
        ? `<a class="adv-btn-reel" href="${escapeHtml(adv.reelUrl)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶</span> Watch Trip Reel</a>`
        : `<button type="button" class="adv-btn-reel" id="advWatchReel"><span aria-hidden="true">▶</span> Watch Trip Reel</button>`;
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
    ${reviewBook}
    <div class="adv-detail-actions">
      ${reelBtn}
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
    setPinActive(null);
    drawPinToCardLine(null);
    const panel = document.getElementById("advDetailPanel");
    const backdrop = document.getElementById("advDetailBackdrop");
    panel?.setAttribute("hidden", "");
    backdrop?.setAttribute("hidden", "");
    document.body.classList.remove("adv-detail-open");
    document.getElementById("advMobileHint")?.removeAttribute("hidden");
    const url = new URL(window.location.href);
    url.searchParams.delete("dest");
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
function selectDestination(id) {
    const adv = getAdventureById(id);
    if (!adv)
        return;
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
    if (adv)
        openDetail(adv);
}
document.addEventListener("DOMContentLoaded", () => {
    updateHeaderAuth();
    bindChrome();
    void (async () => {
        await loadTravelGalleryFromApi();
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
        if (e.key === "Escape" && document.body.classList.contains("adv-detail-open")) {
            if (document.body.classList.contains("adv-lightbox-open"))
                closeLightbox();
            else
                closeDetail();
        }
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
    }
    catch {
        if (loading)
            loading.textContent = "Map could not load. Use the destination buttons below.";
    }
}
