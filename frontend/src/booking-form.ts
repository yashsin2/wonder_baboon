import { API_BASE_URL, getSession, logger, parseError, showMessagePopup, showSuccessModal } from "./config.js";
import type { Trip } from "./config.js";
import {
  BookingSavedPayload,
  PaymentKind,
  bookingAdvanceNoticeText,
  completeBookingWithOptionalRazorpay,
  fetchRazorpayConfig,
  handlePaymentFlowError,
} from "./razorpay-checkout.js";

export function guestBookingFieldsHtml(): string {
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

export function bookingModalActionsHtml(): string {
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

export function normalizeIndianMobile(input: string): string | null {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length >= 12) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return digits;
}

function isValidOptionalEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function setFieldError(modal: HTMLElement, fieldId: string, message: string): void {
  const input = modal.querySelector<HTMLElement>(`#${fieldId}`);
  const err = modal.querySelector<HTMLElement>(`#${fieldId}_err`);
  if (err) {
    err.textContent = message;
    err.hidden = !message;
  }
  input?.classList.toggle("bk-input-invalid", !!message);
}

export function clearBookingFieldErrors(modal: HTMLElement): void {
  for (const id of ["bk_name", "bk_mobile", "bk_email"]) {
    setFieldError(modal, id, "");
  }
}

export function validateGuestBookingFields(modal: HTMLElement): {
  ok: boolean;
  name?: string;
  mobile?: string;
  email?: string;
} {
  clearBookingFieldErrors(modal);
  let ok = true;
  const name = (modal.querySelector("#bk_name") as HTMLInputElement | null)?.value.trim() || "";
  const mobileRaw = (modal.querySelector("#bk_mobile") as HTMLInputElement | null)?.value.trim() || "";
  const email = (modal.querySelector("#bk_email") as HTMLInputElement | null)?.value.trim() || "";

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

  if (!ok) return { ok };
  return { ok: true, name, mobile: mobile!, email: email || undefined };
}

export function wireBookingMobileField(modal: HTMLElement): void {
  const input = modal.querySelector<HTMLInputElement>("#bk_mobile");
  if (!input) return;
  input.addEventListener("input", () => {
    let digits = input.value.replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length > 10) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length > 10) digits = digits.slice(0, 10);
    if (input.value !== digits) input.value = digits;
    setFieldError(modal, "bk_mobile", "");
  });
}

export function setupBookingPaymentUi(
  modal: HTMLElement,
  onPay: (kind: PaymentKind) => void,
): void {
  const note = modal.querySelector<HTMLElement>("#bk_pay_note");
  const payAdvance = modal.querySelector<HTMLButtonElement>("#bk_pay_advance");
  const payFull = modal.querySelector<HTMLButtonElement>("#bk_pay_full");
  const unavailable = modal.querySelector<HTMLElement>("#bk_pay_unavailable");

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
      if (payFull) payFull.disabled = false;
      if (unavailable) unavailable.hidden = true;
    } else {
      if (payAdvance) payAdvance.disabled = true;
      if (payFull) payFull.disabled = true;
      if (unavailable) unavailable.hidden = false;
    }
  });

  payAdvance?.addEventListener("click", () => {
    if (!payAdvance.disabled) onPay("advance");
  });
  payFull?.addEventListener("click", () => {
    if (!payFull.disabled) onPay("full");
  });

  modal.querySelector<HTMLFormElement>("#bk_form")?.addEventListener("submit", (event) => {
    event.preventDefault();
  });
}

export async function submitBookingAndPay(
  modal: HTMLElement,
  trip: Trip,
  paymentKind: PaymentKind,
  opts: {
    date: string;
    people: number;
    extraNames: string[];
    isLoggedIn: boolean;
    token: string | null;
    onBusy?: (label: string) => void;
    onIdle?: () => void;
  },
): Promise<void> {
  const { token, user } = getSession();
  const { date, people, extraNames, isLoggedIn, onBusy, onIdle } = opts;

  onBusy?.("Booking…");

  try {
    const payCfg = await fetchRazorpayConfig();
    let saved: BookingSavedPayload = {};
    let contact: { name?: string; email?: string; mobile?: string } = {};

    if (isLoggedIn && token) {
      const res = await fetch(`${API_BASE_URL}/bookings/user`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          trip_id: trip._id,
          date_of_travel: date,
          number_of_people: people,
          additional_travelers: extraNames,
        }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      saved = await res.json();
      contact = { name: user?.name, email: user?.email, mobile: user?.mobile };
    } else {
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
          additional_travelers: extraNames,
        }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      saved = await res.json();
      contact = { name: guest.name, email: guest.email, mobile: guest.mobile };
    }

    const refundDays = saved.advance_refund_days ?? payCfg.advance_refund_days ?? 12;
    const canPayOnline =
      payCfg.enabled &&
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
        const { message } = await completeBookingWithOptionalRazorpay(
          saved,
          contact,
          trip.title,
          date,
          undefined,
          paymentKind,
        );
        modal.remove();
        showSuccessModal("Booking confirmed", message);
      } catch (payError) {
        modal.remove();
        const bookingId = (saved.booking_id || "").trim();
        const pendingToken = (saved.pending_token || "").trim();
        handlePaymentFlowError(
          payError,
          refundDays,
          bookingId || pendingToken
            ? {
                bookingId: bookingId || undefined,
                pendingToken: pendingToken || undefined,
                paymentKind,
                contact,
                tripTitle: trip.title,
                travelDate: date,
              }
            : undefined,
        );
        logger.warn("payment not completed", payError);
      }
      return;
    }

    if (payCfg.enabled && !canPayOnline) {
      throw new Error(
        "Online payment could not be started. Please try again or contact Wonder Baboon on WhatsApp.",
      );
    }

    throw new Error(
      "Online payment is required to confirm your seat. Please try again later or contact Wonder Baboon on WhatsApp.",
    );
  } catch (error) {
    logger.error("booking failed", error);
    const msg = error instanceof Error ? error.message : "Booking failed";
    if (/mobile/i.test(msg)) {
      const err = modal.querySelector<HTMLElement>("#bk_mobile_err");
      const input = modal.querySelector<HTMLElement>("#bk_mobile");
      if (err) {
        err.textContent = "Please enter a valid mobile number";
        err.hidden = false;
      }
      input?.classList.add("bk-input-invalid");
    } else if (/email/i.test(msg)) {
      const err = modal.querySelector<HTMLElement>("#bk_email_err");
      const input = modal.querySelector<HTMLElement>("#bk_email");
      if (err) {
        err.textContent = "Please enter a valid email address";
        err.hidden = false;
      }
      input?.classList.add("bk-input-invalid");
    } else {
      showMessagePopup(msg, "error");
    }
  } finally {
    onIdle?.();
  }
}
