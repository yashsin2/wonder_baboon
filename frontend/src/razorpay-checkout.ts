import { API_BASE_URL, logger, mountWbModal, parseError, showSuccessModal } from "./config.js";

function payLog(level: "info" | "warn" | "error", step: string, detail?: unknown): void {
  const msg = detail !== undefined ? `[wb-pay] ${step}` : `[wb-pay] ${step}`;
  if (level === "info") logger.info(msg, detail ?? "");
  else if (level === "warn") logger.warn(msg, detail ?? "");
  else logger.error(msg, detail ?? "");
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: unknown) => void) => void;
    };
  }
}

export interface RazorpayConfig {
  enabled: boolean;
  key_id: string;
  test_mode?: boolean;
  advance_percent: number;
  advance_refund_days?: number;
  requires_payment_to_confirm?: boolean;
}

export interface RazorpayPayResult {
  payment: string;
  package_total_inr: number;
  advance_payment_inr: number;
  balance_due_inr: number;
  message?: string;
}

export interface BookingSavedPayload {
  message?: string;
  booking_id?: string;
  pending_token?: string;
  saved_to_database?: boolean;
  razorpay_enabled?: boolean;
  advance_percent?: number;
  advance_refund_days?: number;
  requires_payment_to_confirm?: boolean;
}

let scriptPromise: Promise<void> | null = null;

export function advanceRefundPolicyText(refundDays = 12): string {
  const days = Math.max(1, Math.floor(refundDays));
  return `Advance is refundable only if you cancel at least ${days} day${days === 1 ? "" : "s"} before the trip start date.`;
}

export function bookingAdvanceNoticeText(advancePercent: number, refundDays = 12): string {
  return `Pay ${advancePercent}% advance online to confirm your seat. ${advanceRefundPolicyText(refundDays)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type PaymentKind = "advance" | "full";

export type PaymentResumeContext = {
  bookingId?: string;
  pendingToken?: string;
  paymentKind?: PaymentKind;
  contact: { name?: string; email?: string; mobile?: string };
  tripTitle: string;
  travelDate: string;
};

function hasPaymentResumeRef(resume?: PaymentResumeContext): boolean {
  return !!(resume?.bookingId?.trim() || resume?.pendingToken?.trim());
}

/** Centered modal for payment incomplete / failed (not a full-width red toast). */
export function showPaymentIncompleteModal(
  refundDays = 12,
  options?: {
    providerError?: string;
    cancelled?: boolean;
    resume?: PaymentResumeContext;
  }
): void {
  document.getElementById("wbPayAlertModal")?.remove();
  const providerError = (options?.providerError || "").trim();
  const cancelled = options?.cancelled ?? !providerError;

  const title = providerError ? "Payment could not open" : "Complete advance to confirm";
  const lead = providerError
    ? escapeHtml(providerError)
    : cancelled
      ? "Your seat is <strong>not confirmed</strong> until advance payment succeeds."
      : "Please complete the advance payment to confirm your booking.";

  const wrap = document.createElement("div");
  wrap.id = "wbPayAlertModal";
  wrap.className = "wb-modal";
  wrap.innerHTML = `
    <div class="wb-modal-card wb-pay-alert-card" role="alertdialog" aria-labelledby="wbPayAlertTitle">
      <button type="button" class="wb-pay-alert-close" aria-label="Close">&times;</button>
      <div class="wb-pay-alert-icon" aria-hidden="true">${providerError ? "!" : "₹"}</div>
      <h3 id="wbPayAlertTitle">${escapeHtml(title)}</h3>
      <p class="wb-pay-alert-lead">${lead}</p>
      <ul class="wb-pay-alert-list">
        <li>Tap <strong>Book &amp; pay</strong> again to open Razorpay and retry.</li>
        <li>${escapeHtml(advanceRefundPolicyText(refundDays))}</li>
      </ul>
      <div class="wb-modal-actions">
        ${hasPaymentResumeRef(options?.resume) ? `<button type="button" class="wb-primary" id="wbPayAlertRetry">Retry payment</button>` : ""}
        <button type="button" class="${hasPaymentResumeRef(options?.resume) ? "wb-cancel" : "wb-primary"}" id="wbPayAlertOk">Got it</button>
      </div>
    </div>
  `;
  const close = mountWbModal(wrap);
  wrap.querySelector(".wb-pay-alert-close")?.addEventListener("click", close);
  wrap.querySelector("#wbPayAlertOk")?.addEventListener("click", close);
  wrap.addEventListener("click", (event) => {
    if (event.target === wrap) close();
  });
  const resume = options?.resume;
  wrap.querySelector("#wbPayAlertRetry")?.addEventListener("click", () => {
    if (!hasPaymentResumeRef(resume)) return;
    close();
    void (async () => {
      try {
        const saved: BookingSavedPayload = resume?.pendingToken
          ? {
              pending_token: resume.pendingToken,
              razorpay_enabled: true,
              advance_refund_days: refundDays,
            }
          : {
              booking_id: resume?.bookingId,
              razorpay_enabled: true,
              advance_refund_days: refundDays,
            };
        const { message } = await completeBookingWithOptionalRazorpay(
          saved,
          resume!.contact,
          resume!.tripTitle,
          resume!.travelDate,
          undefined,
          resume?.paymentKind || "advance",
        );
        showSuccessModal("Booking confirmed", message);
      } catch (err) {
        handlePaymentFlowError(err, refundDays, resume);
      }
    })();
  });
}

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Razorpay checkout script failed to load")));
      if (window.Razorpay) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpay = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Razorpay checkout script failed to load"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function fetchRazorpayConfig(): Promise<RazorpayConfig> {
  const res = await fetch(`${API_BASE_URL}/payments/razorpay/config`);
  if (!res.ok) return { enabled: false, key_id: "", advance_percent: 30, advance_refund_days: 12 };
  const data = (await res.json()) as RazorpayConfig;
  return {
    enabled: !!data.enabled,
    key_id: data.key_id || "",
    advance_percent: Number(data.advance_percent) || 30,
    advance_refund_days: Number(data.advance_refund_days) || 12,
    requires_payment_to_confirm: !!data.requires_payment_to_confirm,
  };
}

function isProviderSetupError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /razorpay authentication|razorpay api keys|authentication failed|invalid.*key|401/i.test(m) ||
    /could not create razorpay order|could not attach payment order|could not create payment order/i.test(
      m
    ) ||
    /does not exist|bad_request_error|invalid.*order/i.test(m) ||
    /connection reset|connection aborted|network|failed to fetch|load failed|cors/i.test(m) ||
    /live razorpay keys cannot|checkout closed before payment/i.test(m)
  );
}

function isNetworkOrCorsError(message: string): boolean {
  const m = message.toLowerCase();
  return /failed to fetch|networkerror|load failed|network request|cors/i.test(m);
}

export type BookingPaymentHooks = {
  /** After booking is saved and Razorpay order is being created */
  onAwaitingPayment?: () => void;
  /** Right before Razorpay checkout modal opens */
  onCheckoutOpen?: () => void;
};

export type BookingPaymentRef = { bookingId?: string; pendingToken?: string; paymentKind?: PaymentKind };

function paymentRefBody(ref: BookingPaymentRef): Record<string, string> {
  const pending = (ref.pendingToken || "").trim();
  const bookingId = (ref.bookingId || "").trim();
  const kind = ref.paymentKind || "advance";
  if (pending) return { pending_token: pending, payment_kind: kind };
  return { booking_id: bookingId, payment_kind: kind };
}

export async function payAdvanceForBooking(
  ref: BookingPaymentRef,
  contact: { name?: string; email?: string; mobile?: string },
  hooks?: BookingPaymentHooks
): Promise<RazorpayPayResult> {
  const pendingToken = (ref.pendingToken || "").trim();
  const bookingId = (ref.bookingId || "").trim();
  payLog("info", "payAdvance start", {
    bookingId: bookingId || undefined,
    pendingToken: pendingToken ? "[present]" : undefined,
    api: API_BASE_URL,
    host: window.location.hostname,
  });
  await loadRazorpayScript();
  payLog("info", "checkout.js loaded", { hasRazorpay: !!window.Razorpay });
  const orderRes = await fetch(`${API_BASE_URL}/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(paymentRefBody(ref)),
  });
  if (!orderRes.ok) {
    const detail = await parseError(orderRes);
    payLog("error", "create-order failed", { status: orderRes.status, detail });
    const err = new Error(detail);
    (err as Error & { providerSetup?: boolean }).providerSetup = isProviderSetupError(detail);
    throw err;
  }
  const order = (await orderRes.json()) as {
    order_id: string;
    amount?: number;
    amount_paise?: number;
    currency?: string;
    key_id: string;
    advance_payment_inr: number;
    balance_due_inr: number;
    package_total_inr: number;
    advance_percent: number;
    payment_kind?: PaymentKind;
  };

  const amountPaise = Number(order.amount ?? order.amount_paise ?? 0);
  const currency = order.currency || "INR";
  payLog("info", "create-order ok", {
    order_id: order.order_id,
    key_prefix: (order.key_id || "").slice(0, 16),
    amount_paise: amountPaise,
    advance_inr: order.advance_payment_inr,
  });
  if (!order.order_id || !order.key_id) {
    payLog("error", "create-order response missing fields", order);
    throw new Error("Could not start Razorpay checkout (missing order). Try again.");
  }
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    payLog("error", "invalid amount for checkout", { amountPaise, order });
    throw new Error(
      `Could not start Razorpay checkout (invalid amount ₹${Math.round(amountPaise / 100)}). Contact Wonder Baboon.`
    );
  }

  const host = window.location.hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || /^192\.168\.\d+\.\d+$/.test(host);
  if (isLocal && order.key_id.startsWith("rzp_live_")) {
    const err = new Error(
      "Live Razorpay keys cannot open checkout on localhost. Put rzp_test_ keys in .env for local dev, or test on https://wonderbaboon.com."
    );
    (err as Error & { providerSetup?: boolean }).providerSetup = true;
    throw err;
  }

  hooks?.onAwaitingPayment?.();
  document.body.classList.add("wb-razorpay-checkout");

  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      document.body.classList.remove("wb-razorpay-checkout");
      payLog("error", "window.Razorpay missing after script load");
      reject(new Error("Razorpay checkout is not available in this browser"));
      return;
    }

    let checkoutPhase: "open" | "paying" | "settled" = "open";
    const finish = (fn: () => void): void => {
      if (checkoutPhase === "settled") return;
      checkoutPhase = "settled";
      document.body.classList.remove("wb-razorpay-checkout");
      fn();
    };

    const verifyOnServer = async (response: Record<string, string>): Promise<void> => {
      payLog("info", "razorpay handler success, verifying", {
        order_id: response.razorpay_order_id,
        payment_id: response.razorpay_payment_id,
      });
      const verifyRes = await fetch(`${API_BASE_URL}/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...paymentRefBody(ref),
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }),
      });
      if (!verifyRes.ok) {
        const detail = await parseError(verifyRes);
        payLog("error", "verify-payment failed", { status: verifyRes.status, detail });
        throw new Error(detail);
      }
      const verified = (await verifyRes.json()) as RazorpayPayResult & { success?: boolean };
      payLog("info", "verify-payment ok", verified);
      finish(() => resolve(verified));
    };

    const checkoutOptions: Record<string, unknown> = {
      key: order.key_id,
      amount: amountPaise,
      currency,
      name: "Wonder Baboon",
      description:
        order.payment_kind === "full"
          ? "Full trip payment"
          : `${order.advance_percent}% trip advance`,
      order_id: order.order_id,
      prefill: {
        name: contact.name || "",
        email: contact.email || "",
        contact: (contact.mobile || "").replace(/\D/g, "").slice(-10),
      },
      theme: { color: "#c4e538" },
    };
    const rzp = new window.Razorpay({
      ...checkoutOptions,
      handler: (response: Record<string, string>) => {
        checkoutPhase = "paying";
        void verifyOnServer(response).catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error("Payment verification failed");
          payLog("error", "verify after handler failed", error);
          (error as Error & { verifyFailed?: boolean }).verifyFailed = true;
          finish(() => reject(error));
        });
      },
      modal: {
        ondismiss: () => {
          payLog("warn", "razorpay modal ondismiss", { phase: checkoutPhase });
          window.setTimeout(() => {
            if (checkoutPhase !== "open") return;
            payLog("warn", "treating ondismiss as checkout closed before pay");
            const e = new Error(
              "Razorpay closed before payment completed. If the payment window never appeared, use test keys (rzp_test_) on localhost or check your domain in the Razorpay Dashboard."
            );
            (e as Error & { providerSetup?: boolean }).providerSetup = true;
            finish(() => reject(e));
          }, 4000);
        },
      },
    });

    rzp.on("payment.failed", (raw: unknown) => {
      const response = raw as { error?: { description?: string; reason?: string; code?: string } };
      payLog("error", "razorpay payment.failed", response);
      const desc =
        response?.error?.description ||
        response?.error?.reason ||
        "Payment failed. Please try again.";
      const e = new Error(desc);
      const err = e as Error & { paymentFailed?: boolean; providerSetup?: boolean };
      err.paymentFailed = true;
      if (/does not exist|bad_request/i.test(desc)) {
        err.providerSetup = true;
      }
      finish(() => reject(e));
    });

    hooks?.onCheckoutOpen?.();
    payLog("info", "calling rzp.open()", { order_id: order.order_id, amount_paise: amountPaise });
    window.setTimeout(() => {
      try {
        rzp.open();
        payLog("info", "rzp.open() called");
      } catch (openErr: unknown) {
        const msg =
          openErr instanceof Error ? openErr.message : "Could not open Razorpay checkout";
        payLog("error", "rzp.open() threw", openErr);
        const e = new Error(msg);
        (e as Error & { providerSetup?: boolean }).providerSetup = true;
        finish(() => reject(e));
      }
    }, 150);
  });
}

export function handlePaymentFlowError(
  error: unknown,
  refundDays = 12,
  resume?: PaymentResumeContext
): void {
  const message = error instanceof Error ? error.message : "Payment could not be completed";
  payLog("error", "handlePaymentFlowError", {
    message,
    error,
    bookingId: resume?.bookingId,
  });
  const cancelled =
    error instanceof Error && (error as Error & { cancelled?: boolean }).cancelled === true;
  const paymentFailed =
    error instanceof Error && (error as Error & { paymentFailed?: boolean }).paymentFailed === true;
  const verifyFailed =
    error instanceof Error && (error as Error & { verifyFailed?: boolean }).verifyFailed === true;
  const providerSetup =
    (error instanceof Error && (error as Error & { providerSetup?: boolean }).providerSetup) ||
    isProviderSetupError(message);

  let providerError: string | undefined;
  if (isNetworkOrCorsError(message)) {
    providerError =
      "Could not reach the payment server. Open https://wonderbaboon.com (not www) and try again, or check your connection.";
  } else if (providerSetup || paymentFailed) {
    providerError = message;
  } else if (verifyFailed) {
    providerError =
      message ||
      "Payment may have gone through but we could not confirm your booking. Contact Wonder Baboon with your payment reference before paying again.";
  } else if (message && message !== "Payment cancelled") {
    providerError = message;
  }

  showPaymentIncompleteModal(refundDays, {
    cancelled: cancelled && !providerSetup && !paymentFailed && !verifyFailed,
    providerError,
    resume: resume && hasPaymentResumeRef(resume) ? resume : undefined,
  });
}

export async function completeBookingWithOptionalRazorpay(
  saved: BookingSavedPayload,
  contact: { name?: string; email?: string; mobile?: string },
  tripTitle: string,
  travelDate: string,
  hooks?: BookingPaymentHooks,
  paymentKind: PaymentKind = "advance",
): Promise<{ paidAdvance: boolean; message: string }> {
  const pendingToken = (saved.pending_token || "").trim();
  const bookingId = (saved.booking_id || "").trim();
  const refundDays = saved.advance_refund_days ?? 12;

  if ((!pendingToken && !bookingId) || !saved.razorpay_enabled) {
    return {
      paidAdvance: false,
      message: `Your booking for ${tripTitle} on ${travelDate} is in. Our team will reach out shortly.`,
    };
  }

  const result = await payAdvanceForBooking(
    pendingToken ? { pendingToken, paymentKind } : { bookingId, paymentKind },
    contact,
    hooks,
  );
  const paid = Number(result.advance_payment_inr ?? 0);
  const balance = Number(result.balance_due_inr ?? 0);
  const total = Number(result.package_total_inr ?? 0);
  document.getElementById("wbPayAlertModal")?.remove();

  if (paymentKind === "full" || result.payment === "paid") {
    return {
      paidAdvance: true,
      message: `Your seat is confirmed. Full payment of ₹${(total || paid).toLocaleString("en-IN")} received for ${tripTitle}.`,
    };
  }

  return {
    paidAdvance: true,
    message: `Your seat is confirmed. Advance of ₹${paid.toLocaleString("en-IN")} received for ${tripTitle}. Balance due: ₹${balance.toLocaleString("en-IN")} before the trip. ${advanceRefundPolicyText(refundDays)}`,
  };
}
