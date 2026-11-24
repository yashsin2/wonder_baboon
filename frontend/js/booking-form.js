import { API_BASE_URL, getSession, logger, parseError, showMessagePopup, showSuccessModal } from "./config.js";
import { bookingAdvanceNoticeText, completeBookingWithOptionalRazorpay, fetchRazorpayConfig, handlePaymentFlowError, } from "./razorpay-checkout.js";
export function guestBookingFieldsHtml() {
    return `
      <label for="bk_name">Full name *</label>
      <input id="bk_name" type="text" required minlength="2" autocomplete="name" />
      <p class="bk-field-error" id="bk_name_err" role="alert" hidden></p>
      <label for="bk_mobile">Mobile *</label>
      <div class="bk-mobile-wrap">
        <span class="bk-mobile-prefix" aria-hidden="true">+91</span>
        <input id="bk_mobile" type="tel" required inputmode="numeric" autocomplete="tel-national" placeholder="9876543210" maxlength="11" />
      </div>
      <p class="bk-field-error" id="bk_mobile_err" role="alert" hidden></p>
      <label for="bk_email">Email</label>
      <input id="bk_email" type="email" autocomplete="email" placeholder="you@example.com" />
      <p class="bk-field-error" id="bk_email_err" role="alert" hidden></p>
    `;
}
function esc(raw) {
    return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Date of travel: fixed to the trip's own date (shown, not editable). Falls back to a picker only if the trip has no date. */
export function bookingDateFieldHtml(trip, minDate, fallbackDate) {
    const iso = (trip.startDate || "").trim();
    if (!iso) {
        return `<label>Date of travel *</label>
      <input id="bk_date" type="date" required value="${fallbackDate}" min="${minDate}" />`;
    }
    const pretty = new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
    return `<label>Date of travel</label>
      <input id="bk_date" type="hidden" value="${esc(iso)}" />
      <div class="bk-date-locked" aria-readonly="true">
        <span class="bk-date-locked-value">📅 ${esc(pretty)}</span>
        <span class="bk-date-locked-note">Fixed departure — set by the trip</span>
      </div>`;
}
/** One block per additional traveler: name + mobile + email (so the trip shows up when they log in). */
export function extraTravelerBlocksHtml(count) {
    let html = "";
    for (let i = 0; i < count; i++) {
        html += `
      <fieldset class="bk-extra-block" data-extra-block>
        <legend>Traveler ${i + 2}</legend>
        <label>Full name *</label>
        <input type="text" class="bk-extra-name" required minlength="2" autocomplete="off" />
        <label>Mobile *</label>
        <div class="bk-mobile-wrap">
          <span class="bk-mobile-prefix" aria-hidden="true">+91</span>
          <input type="tel" class="bk-extra-mobile" required inputmode="numeric" placeholder="9876543210" maxlength="11" autocomplete="off" />
        </div>
        <label>Email *</label>
        <input type="email" class="bk-extra-email" required placeholder="friend@example.com" autocomplete="off" />
      </fieldset>`;
    }
    return html;
}
export function wireExtraTravelerMobiles(root) {
    root.querySelectorAll(".bk-extra-mobile").forEach((el) => {
        el.addEventListener("input", () => {
            let d = el.value.replace(/\D/g, "");
            if (d.startsWith("91") && d.length > 10)
                d = d.slice(2);
            if (d.length > 10)
                d = d.slice(0, 10);
            if (el.value !== d)
                el.value = d;
        });
    });
}
/** Reads and validates every extra-traveler block inside `root`. Returns an error message when invalid. */
export function collectExtraTravelers(root, needed) {
    const blocks = Array.from(root.querySelectorAll("[data-extra-block]"));
    if (blocks.length !== needed)
        return { contacts: [], error: "Please fill in every additional traveler's details." };
    const contacts = [];
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const name = b.querySelector(".bk-extra-name")?.value.trim() ?? "";
        const mobile = normalizeIndianMobile(b.querySelector(".bk-extra-mobile")?.value ?? "");
        const email = (b.querySelector(".bk-extra-email")?.value ?? "").trim().toLowerCase();
        const label = `Traveler ${i + 2}`;
        if (name.length < 2)
            return { contacts: [], error: `${label}: please enter the full name.` };
        if (!mobile)
            return { contacts: [], error: `${label}: please enter a valid 10-digit mobile number.` };
        if (!email || !isValidOptionalEmail(email))
            return { contacts: [], error: `${label}: please enter a valid email address.` };
        contacts.push({ name, mobile, email });
    }
    return { contacts };
}
export function bookingModalActionsHtml() {
    return `
      <div class="wb-modal-actions bk-modal-actions">
        <div class="bk-pay-btns" id="bk_pay_btns">
          <button type="button" class="wb-primary" id="bk_pay_advance" disabled>Pay 30% advance</button>
          <button type="button" class="wb-secondary" id="bk_pay_full" disabled>Pay full amount</button>
        </div>
        <p class="bk-pay-unavailable muted" id="bk_pay_unavailable" hidden>
          Online payment is temporarily unavailable. Please try again later or contact us on WhatsApp.
        </p>
        <button type="button" class="wb-cancel" id="bk_cancel">Cancel</button>
      </div>
    `;
}
export function normalizeIndianMobile(input) {
    let digits = String(input || "").replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length >= 12)
        digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith("0"))
        digits = digits.slice(1);
    if (!/^[6-9]\d{9}$/.test(digits))
        return null;
    return digits;
}
function isValidOptionalEmail(email) {
    const trimmed = email.trim();
    if (!trimmed)
        return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
function setFieldError(modal, fieldId, message) {
    const input = modal.querySelector(`#${fieldId}`);
    const err = modal.querySelector(`#${fieldId}_err`);
    if (err) {
        err.textContent = message;
        err.hidden = !message;
    }
    input?.classList.toggle("bk-input-invalid", !!message);
}
export function clearBookingFieldErrors(modal) {
    for (const id of ["bk_name", "bk_mobile", "bk_email"]) {
        setFieldError(modal, id, "");
    }
}
export function validateGuestBookingFields(modal) {
    clearBookingFieldErrors(modal);
    let ok = true;
    const name = modal.querySelector("#bk_name")?.value.trim() || "";
    const mobileRaw = modal.querySelector("#bk_mobile")?.value.trim() || "";
    const email = modal.querySelector("#bk_email")?.value.trim() || "";
    if (name.length < 2) {
        setFieldError(modal, "bk_name", "Please enter your full name");
        ok = false;
    }
    const mobile = normalizeIndianMobile(mobileRaw);
    if (!mobile) {
        setFieldError(modal, "bk_mobile", "Please enter a valid mobile number");
        ok = false;
    }
    if (!isValidOptionalEmail(email)) {
        setFieldError(modal, "bk_email", "Please enter a valid email address");
        ok = false;
    }
    if (!ok)
        return { ok };
    return { ok: true, name, mobile: mobile, email: email || undefined };
}
export function wireBookingMobileField(modal) {
    const input = modal.querySelector("#bk_mobile");
    if (!input)
        return;
    input.addEventListener("input", () => {
        let digits = input.value.replace(/\D/g, "");
        if (digits.startsWith("91") && digits.length > 10)
            digits = digits.slice(2);
        if (digits.length === 11 && digits.startsWith("0"))
            digits = digits.slice(1);
        if (digits.length > 10)
            digits = digits.slice(0, 10);
        if (input.value !== digits)
            input.value = digits;
        setFieldError(modal, "bk_mobile", "");
    });
}
export function setupBookingPaymentUi(modal, onPay) {
    const note = modal.querySelector("#bk_pay_note");
    const payAdvance = modal.querySelector("#bk_pay_advance");
    const payFull = modal.querySelector("#bk_pay_full");
    const unavailable = modal.querySelector("#bk_pay_unavailable");
    void fetchRazorpayConfig().then((cfg) => {
        if (cfg.enabled) {
            if (note) {
                note.hidden = false;
                note.textContent = bookingAdvanceNoticeText(cfg.advance_percent, cfg.advance_refund_days ?? 12);
            }
            if (payAdvance) {
                payAdvance.disabled = false;
                payAdvance.textContent = `Pay ${cfg.advance_percent}% advance`;
            }
            if (payFull)
                payFull.disabled = false;
            if (unavailable)
                unavailable.hidden = true;
        }
        else {
            if (payAdvance)
                payAdvance.disabled = true;
            if (payFull)
                payFull.disabled = true;
            if (unavailable)
                unavailable.hidden = false;
        }
    });
    payAdvance?.addEventListener("click", () => {
        if (!payAdvance.disabled)
            onPay("advance");
    });
    payFull?.addEventListener("click", () => {
        if (!payFull.disabled)
            onPay("full");
    });
    modal.querySelector("#bk_form")?.addEventListener("submit", (event) => {
        event.preventDefault();
    });
}
export async function submitBookingAndPay(modal, trip, paymentKind, opts) {
    const { token, user } = getSession();
    const { date, people, extras, isLoggedIn, onBusy, onIdle } = opts;
    onBusy?.("Booking…");
    try {
        const payCfg = await fetchRazorpayConfig();
        let saved = {};
        let contact = {};
        if (isLoggedIn && token) {
            const res = await fetch(`${API_BASE_URL}/bookings/user`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    trip_id: trip._id,
                    date_of_travel: date,
                    number_of_people: people,
                    additional_contacts: extras,
                }),
            });
            if (!res.ok)
                throw new Error(await parseError(res));
            saved = await res.json();
            contact = { name: user?.name, email: user?.email, mobile: user?.mobile };
        }
        else {
            const guest = validateGuestBookingFields(modal);
            if (!guest.ok || !guest.name || !guest.mobile) {
                onIdle?.();
                return;
            }
            const res = await fetch(`${API_BASE_URL}/bookings/guest`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    trip_id: trip._id,
                    travel_destination: trip.title,
                    date_of_travel: date,
                    full_name: guest.name,
                    mobile: guest.mobile,
                    email: guest.email || null,
                    number_of_people: people,
                    additional_contacts: extras,
                }),
            });
            if (!res.ok)
                throw new Error(await parseError(res));
            saved = await res.json();
            contact = { name: guest.name, email: guest.email, mobile: guest.mobile };
        }
        const refundDays = saved.advance_refund_days ?? payCfg.advance_refund_days ?? 12;
        const canPayOnline = payCfg.enabled &&
            (saved.razorpay_enabled || saved.pending_token || saved.booking_id);
        if (canPayOnline) {
            saved = {
                ...saved,
                razorpay_enabled: true,
                advance_percent: payCfg.advance_percent,
                advance_refund_days: refundDays,
            };
            onBusy?.("Opening payment…");
            try {
                const { message } = await completeBookingWithOptionalRazorpay(saved, contact, trip.title, date, undefined, paymentKind);
                modal.remove();
                showSuccessModal("Booking confirmed", message);
            }
            catch (payError) {
                modal.remove();
                const bookingId = (saved.booking_id || "").trim();
                const pendingToken = (saved.pending_token || "").trim();
                handlePaymentFlowError(payError, refundDays, bookingId || pendingToken
                    ? {
                        bookingId: bookingId || undefined,
                        pendingToken: pendingToken || undefined,
                        paymentKind,
                        contact,
                        tripTitle: trip.title,
                        travelDate: date,
                    }
                    : undefined);
                logger.warn("payment not completed", payError);
            }
            return;
        }
        if (payCfg.enabled && !canPayOnline) {
            throw new Error("Online payment could not be started. Please try again or contact Wonder Baboon on WhatsApp.");
        }
        throw new Error("Online payment is required to confirm your seat. Please try again later or contact Wonder Baboon on WhatsApp.");
    }
    catch (error) {
        logger.error("booking failed", error);
        const msg = error instanceof Error ? error.message : "Booking failed";
        if (/mobile/i.test(msg)) {
            const err = modal.querySelector("#bk_mobile_err");
            const input = modal.querySelector("#bk_mobile");
            if (err) {
                err.textContent = "Please enter a valid mobile number";
                err.hidden = false;
            }
            input?.classList.add("bk-input-invalid");
        }
        else if (/email/i.test(msg)) {
            const err = modal.querySelector("#bk_email_err");
            const input = modal.querySelector("#bk_email");
            if (err) {
                err.textContent = "Please enter a valid email address";
                err.hidden = false;
            }
            input?.classList.add("bk-input-invalid");
        }
        else {
            showMessagePopup(msg, "error");
        }
    }
    finally {
        onIdle?.();
    }
}
