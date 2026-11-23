import { durationWords, prettyRange, todayIso, wireDateRange } from "./date-range.js?v=c001ef5";
import { showToast } from "./admin-ui.js?v=c001ef5";
import { TRIP_STYLE_ORDER, TRIP_STYLES } from "./trip-styles.js?v=c001ef5";
/**
 * Admin → Add trip: a sectioned form with a live trip-card preview.
 *  • start date can't be in the past; end date can't be before start (and opens on the right month)
 *  • duration label (3D/2N) is calculated automatically (✎ to override)
 *  • price shortcuts, style chips, image file check, completeness checklist
 */
const STYLE_ICON = {
    backpackers: "🎒",
    motorcycle_diaries: "🏍️",
    dolce_far_niente: "🌴",
    hikers: "🥾",
};
const LOCATIONS = [
    "Himachal Pradesh", "Uttarakhand", "Uttar Pradesh", "Rajasthan", "Goa", "Kerala", "Karnataka", "Ladakh",
    "Jammu & Kashmir", "Sikkim", "Meghalaya", "Assam", "Gujarat", "Maharashtra", "Tamil Nadu", "Nepal", "Bhutan",
];
const $ = (id) => document.getElementById(id);
const money = (n) => `₹${n.toLocaleString("en-IN")}`;
export function tripFormHtml() {
    const styleChips = TRIP_STYLE_ORDER.map((slug, i) => `
      <label class="atf-chip">
        <input type="radio" name="tripStyleChoice" value="${slug}" ${i === 0 ? "checked" : ""} />
        <span><i>${STYLE_ICON[slug]}</i>${TRIP_STYLES[slug].title}</span>
      </label>`).join("");
    return `
  <div class="atf-layout">
    <form id="tripForm" class="atf-form" novalidate>
      <section class="atf-sec" data-sec="basics">
        <header><span class="atf-num">1</span><div><h4>The basics</h4><p>What is it, and where?</p></div><span class="atf-ok" aria-hidden="true">✓</span></header>
        <div class="form-row">
          <div class="form-group"><label for="tripTitle">Trip title</label>
            <input id="tripTitle" type="text" required autocomplete="off" maxlength="120" placeholder="e.g. Jibhi Backpacking Escape" /></div>
          <div class="form-group"><label for="tripLocation">Location</label>
            <input id="tripLocation" type="text" required autocomplete="off" maxlength="80" list="atfLocations" placeholder="Start typing a state…" />
            <datalist id="atfLocations">${LOCATIONS.map((l) => `<option value="${l}"></option>`).join("")}</datalist></div>
        </div>
      </section>

      <section class="atf-sec" data-sec="dates">
        <header><span class="atf-num">2</span><div><h4>Dates &amp; duration</h4><p>Pick the start first — the end date follows.</p></div><span class="atf-ok" aria-hidden="true">✓</span></header>
        <div class="form-row">
          <div class="form-group"><label for="tripStartDate">Start date</label>
            <input id="tripStartDate" type="date" required /></div>
          <div class="form-group"><label for="tripEndDate">End date</label>
            <input id="tripEndDate" type="date" required disabled /></div>
        </div>
        <div id="atfDateSummary" class="atf-datesummary" aria-live="polite"></div>
        <div class="form-group atf-duration">
          <label for="tripDuration">Duration label <span class="atf-auto" id="atfAuto">auto</span></label>
          <div class="atf-duration-row">
            <input id="tripDuration" type="text" required autocomplete="off" maxlength="30" readonly placeholder="Calculated from the dates" />
            <button type="button" class="btn-second" id="atfEditDuration">✎ Edit</button>
          </div>
          <p class="form-hint">Shown on the trip card, e.g. <b>3D/2N</b>. You rarely need to change it.</p>
        </div>
      </section>

      <section class="atf-sec" data-sec="price">
        <header><span class="atf-num">3</span><div><h4>Price &amp; style</h4><p>Per person, and which vibe it belongs to.</p></div><span class="atf-ok" aria-hidden="true">✓</span></header>
        <div class="form-group"><label for="tripPrice">Price per person</label>
          <div class="atf-price"><span>₹</span><input id="tripPrice" type="number" min="0" max="200000" required inputmode="numeric" placeholder="7999" /></div>
          <div class="atf-quick">
            <button type="button" data-price-add="500">+₹500</button><button type="button" data-price-add="1000">+₹1,000</button>
            <button type="button" data-price-add="2500">+₹2,500</button><button type="button" data-price-set="0">Clear</button>
          </div></div>
        <div class="form-group"><label>Trip style / category</label>
          <div class="atf-chips" role="radiogroup" aria-label="Trip style">${styleChips}</div>
          <select id="tripStyle" hidden required>${TRIP_STYLE_ORDER.map((s) => `<option value="${s}">${TRIP_STYLES[s].title}</option>`).join("")}</select></div>
      </section>

      <section class="atf-sec" data-sec="media">
        <header><span class="atf-num">4</span><div><h4>Photo &amp; itinerary</h4><p>The cover photo must already be in the <code>assets</code> folder.</p></div><span class="atf-ok" aria-hidden="true">✓</span></header>
        <div class="form-group"><label for="tripImageName">Image file name</label>
          <input id="tripImageName" type="text" placeholder="lake.jpg" required autocomplete="off" maxlength="120" />
          <p class="atf-imgstatus" id="atfImgStatus">Type the file name to preview it.</p></div>
        <div class="form-group"><label for="newTripItineraryPdf">Itinerary PDF <span class="atf-opt">optional</span></label>
          <label class="atf-drop" id="atfDrop"><input id="newTripItineraryPdf" type="file" accept="application/pdf,.pdf" />
            <span id="atfDropText">📄 Drop a PDF here or click to choose</span></label></div>
      </section>

      <div class="atf-submitrow">
        <button type="submit" class="form-submit" id="atfSubmit">Add trip to database</button>
        <span class="atf-submit-hint" id="atfSubmitHint"></span>
      </div>
    </form>

    <aside class="atf-preview" aria-label="Live preview">
      <p class="atf-preview-label">Live preview</p>
      <article class="atf-pcard">
        <div class="atf-pmedia">
          <img id="atfImg" alt="" hidden /><div class="atf-pph" id="atfImgPh">📷 Cover photo</div>
          <span class="atf-ptag" id="atfTag"></span><span class="atf-pdate" id="atfPDate">Pick dates</span>
        </div>
        <div class="atf-pbody">
          <h5 id="atfPTitle">Your trip title</h5>
          <p id="atfPLoc">📍 Location</p>
          <div class="atf-pmeta"><span id="atfPDur">📅 —</span><strong id="atfPPrice">₹ —</strong></div>
        </div>
      </article>
      <div class="atf-meter"><div id="atfMeterBar"></div></div>
      <ul class="atf-checklist" id="atfChecklist"></ul>
    </aside>
  </div>`;
}
export function initAdminTripForm() {
    const host = document.getElementById("tripFormHost");
    if (!host || host.dataset.ready)
        return;
    host.dataset.ready = "1";
    host.innerHTML = tripFormHtml();
    const form = $("tripForm");
    const title = $("tripTitle");
    const location = $("tripLocation");
    const start = $("tripStartDate");
    const end = $("tripEndDate");
    const duration = $("tripDuration");
    const price = $("tripPrice");
    const styleSel = $("tripStyle");
    const image = $("tripImageName");
    const pdf = $("newTripItineraryPdf");
    let imageOk = false;
    let imageTimer = 0;
    let imageSeq = 0;
    let ready = false; // the date callback fires during setup, before `range` exists
    const range = wireDateRange({
        start,
        end,
        futureOnly: true,
        durationInput: duration,
        manualOnType: false,
        summary: $("atfDateSummary"),
        onChange: () => {
            if (ready)
                refresh();
        },
    });
    ready = true;
    // duration: auto by default, ✎ to type your own, auto again on demand
    $("atfEditDuration").addEventListener("click", () => {
        if (duration.readOnly) {
            duration.readOnly = false;
            range.setDurationManual(true);
            duration.focus();
            duration.select();
            $("atfAuto").textContent = "manual";
            $("atfAuto").classList.add("is-manual");
            $("atfEditDuration").textContent = "↺ Auto";
        }
        else {
            duration.readOnly = true;
            range.setDurationManual(false);
            $("atfAuto").textContent = "auto";
            $("atfAuto").classList.remove("is-manual");
            $("atfEditDuration").textContent = "✎ Edit";
        }
    });
    // price shortcuts
    form.querySelectorAll("[data-price-add]").forEach((b) => b.addEventListener("click", () => {
        price.value = String((Number(price.value) || 0) + Number(b.dataset.priceAdd));
        price.dispatchEvent(new Event("input", { bubbles: true }));
    }));
    form.querySelector("[data-price-set]")?.addEventListener("click", () => {
        price.value = "";
        price.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // style chips <-> hidden select
    form.querySelectorAll('input[name="tripStyleChoice"]').forEach((r) => r.addEventListener("change", () => {
        styleSel.value = r.value;
        refresh();
    }));
    // image: check the file really exists in assets/
    const checkImage = () => {
        const name = image.value.trim();
        const seq = ++imageSeq;
        const img = $("atfImg");
        const status = $("atfImgStatus");
        if (!name) {
            imageOk = false;
            img.hidden = true;
            $("atfImgPh").hidden = false;
            status.textContent = "Type the file name to preview it.";
            status.className = "atf-imgstatus";
            refresh();
            return;
        }
        status.textContent = "Checking…";
        status.className = "atf-imgstatus";
        const probe = new Image();
        probe.onload = () => {
            if (seq !== imageSeq)
                return;
            imageOk = true;
            img.src = probe.src;
            img.hidden = false;
            $("atfImgPh").hidden = true;
            status.textContent = "✓ Found in assets/";
            status.className = "atf-imgstatus is-ok";
            refresh();
        };
        probe.onerror = () => {
            if (seq !== imageSeq)
                return;
            imageOk = false;
            img.hidden = true;
            $("atfImgPh").hidden = false;
            status.textContent = "✗ Not found in assets/ — check the spelling and extension (.jpg / .JPG).";
            status.className = "atf-imgstatus is-bad";
            refresh();
        };
        probe.src = `/assets/${encodeURIComponent(name)}`;
    };
    image.addEventListener("input", () => {
        window.clearTimeout(imageTimer);
        imageTimer = window.setTimeout(checkImage, 350);
    });
    // pdf drop zone label
    pdf.addEventListener("change", () => {
        $("atfDropText").textContent = pdf.files?.[0] ? `📄 ${pdf.files[0].name}` : "📄 Drop a PDF here or click to choose";
    });
    const drop = $("atfDrop");
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-over")));
    const checks = () => {
        const info = range.info();
        return [
            { key: "title", label: "Trip title", ok: title.value.trim().length >= 3, sec: "basics" },
            { key: "location", label: "Location", ok: location.value.trim().length >= 2, sec: "basics" },
            { key: "dates", label: "Start & end dates", ok: info.valid, sec: "dates" },
            { key: "duration", label: "Duration label", ok: duration.value.trim().length >= 2, sec: "dates" },
            { key: "price", label: "Price", ok: price.value !== "" && Number(price.value) >= 0, sec: "price" },
            { key: "image", label: "Cover photo found", ok: imageOk, sec: "media" },
        ];
    };
    function refresh() {
        const info = range.info();
        const list = checks();
        const done = list.filter((c) => c.ok).length;
        // preview card
        const style = (styleSel.value || "backpackers");
        $("atfTag").textContent = TRIP_STYLES[style]?.shortLabel ?? "";
        $("atfPTitle").textContent = title.value.trim() || "Your trip title";
        $("atfPLoc").textContent = `📍 ${location.value.trim() || "Location"}`;
        $("atfPDate").textContent = info.valid ? prettyRange(info.start, info.end) : "Pick dates";
        $("atfPDur").textContent = `📅 ${duration.value.trim() || (info.days ? durationWords(info.days) : "—")}`;
        $("atfPPrice").textContent = price.value !== "" ? money(Number(price.value)) : "₹ —";
        // checklist + meter + section ticks
        $("atfChecklist").innerHTML = list.map((c) => `<li class="${c.ok ? "is-ok" : ""}"><span>${c.ok ? "✓" : "○"}</span>${c.label}</li>`).join("");
        $("atfMeterBar").style.width = `${(done / list.length) * 100}%`;
        form.querySelectorAll(".atf-sec").forEach((sec) => {
            const mine = list.filter((c) => c.sec === sec.dataset.sec);
            sec.classList.toggle("is-complete", mine.length > 0 && mine.every((c) => c.ok));
        });
        $("atfSubmitHint").textContent = done === list.length ? "Looks good — ready to publish." : `${list.length - done} thing${list.length - done === 1 ? "" : "s"} left`;
    }
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    // block submit (before the main handler runs) while something is missing
    form.addEventListener("submit", (event) => {
        const missing = checks().filter((c) => !c.ok);
        if (!missing.length)
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        form.querySelectorAll(".atf-sec").forEach((sec) => {
            const bad = missing.some((m) => m.sec === sec.dataset.sec);
            sec.classList.toggle("is-incomplete", bad);
            if (bad)
                window.setTimeout(() => sec.classList.remove("is-incomplete"), 1600);
        });
        showToast(`Still needed: ${missing.map((m) => m.label.toLowerCase()).join(", ")}.`, "error");
        const first = form.querySelector(`.atf-sec[data-sec="${missing[0].sec}"]`);
        first?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, true);
    form.addEventListener("reset", () => {
        window.setTimeout(() => {
            styleSel.value = "backpackers";
            form.querySelector('input[name="tripStyleChoice"][value="backpackers"]').checked = true;
            duration.readOnly = true;
            $("atfAuto").textContent = "auto";
            $("atfAuto").classList.remove("is-manual");
            $("atfEditDuration").textContent = "✎ Edit";
            $("atfDropText").textContent = "📄 Drop a PDF here or click to choose";
            imageOk = false;
            checkImage();
            refresh();
        }, 0);
    });
    start.min = todayIso();
    refresh();
}
