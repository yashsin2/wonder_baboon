import { API_BASE_URL, parseError } from "./config.js";

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

/** Centered modal for payment incomplete / failed (not a full-width red toast). */
export function showPaymentIncompleteModal(
  refundDays = 12,
  options?: { providerError?: string; cancelled?: boolean }
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
        <button type="button" class="wb-primary" id="wbPayAlertOk">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = (): void => wrap.remove();
  wrap.querySelector(".wb-pay-alert-close")?.addEventListener("click", close);
  wrap.querySelector("#wbPayAlertOk")?.addEventListener("click", close);
  wrap.addEventListener("click", (event) => {
    if (event.target === wrap) close();
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
    /could not create razorpay order/i.test(m)
  );
}

export type BookingPaymentHooks = {
  /** After booking is saved and Razorpay order is being created */
  onAwaitingPayment?: () => void;
  /** Right before Razorpay checkout modal opens */
  onCheckoutOpen?: () => void;
};

export async function payAdvanceForBooking(
  bookingId: string,
  contact: { name?: string; email?: string; mobile?: string },
  hooks?: BookingPaymentHooks
): Promise<RazorpayPayResult> {
  await loadRazorpayScript();
  const orderRes = await fetch(`${API_BASE_URL}/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ booking_id: bookingId }),
  });
  if (!orderRes.ok) {
    const detail = await parseError(orderRes);
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
  };

  const amountPaise = Number(order.amount ?? order.amount_paise ?? 0);
  const currency = order.currency || "INR";

  hooks?.onAwaitingPayment?.();

  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error("Razorpay checkout is not available in this browser"));
      return;
    }

    let checkoutPhase: "open" | "paying" | "settled" = "open";
    const finish = (fn: () => void): void => {
      if (checkoutPhase === "settled") return;
      checkoutPhase = "settled";
      fn();
    };

    const verifyOnServer = async (response: Record<string, string>): Promise<void> => {
      const verifyRes = await fetch(`${API_BASE_URL}/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bookingId,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }),
      });
      if (!verifyRes.ok) {
        throw new Error(await parseError(verifyRes));
      }
      const verified = (await verifyRes.json()) as RazorpayPayResult & { success?: boolean };
      finish(() => resolve(verified));
    };

    const rzp = new window.Razorpay({
      key: order.key_id,
      amount: amountPaise,
      currency,
      name: "Wonder Baboon",
      description: `${order.advance_percent}% trip advance`,
      order_id: order.order_id,
      prefill: {
        name: contact.name || "",
        email: contact.email || "",
        contact: contact.mobile || "",
      },
      theme: { color: "#c4e538" },
      handler: (response: Record<string, string>) => {
        checkoutPhase = "paying";
        void verifyOnServer(response).catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error("Payment verification failed");
          (error as Error & { verifyFailed?: boolean }).verifyFailed = true;
          finish(() => reject(error));
        });
      },
      modal: {
        ondismiss: () => {
          // Razorpay may call ondismiss when the modal closes after success — ignore unless still open.
          window.setTimeout(() => {
            if (checkoutPhase !== "open") return;
            finish(() => {
              const e = new Error("Payment cancelled");
              (e as Error & { cancelled?: boolean }).cancelled = true;
              reject(e);
            });
          }, 2500);
        },
      },
    });

    rzp.on("payment.failed", (raw: unknown) => {
      const response = raw as { error?: { description?: string; reason?: string } };
      const desc =
        response?.error?.description ||
        response?.error?.reason ||
        "Payment failed. Please try again.";
      const e = new Error(desc);
      (e as Error & { paymentFailed?: boolean }).paymentFailed = true;
      finish(() => reject(e));
    });

    hooks?.onCheckoutOpen?.();
    rzp.open();
  });
}

export function handlePaymentFlowError(error: unknown, refundDays = 12): void {
  const message = error instanceof Error ? error.message : "Payment could not be completed";
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
  if (providerSetup || paymentFailed) {
    providerError = message;
  } else if (verifyFailed) {
    providerError =
      message ||
      "Payment may have gone through but we could not confirm your booking. Contact Wonder Baboon with your payment reference before paying again.";
  }

  showPaymentIncompleteModal(refundDays, {
    cancelled: cancelled && !providerSetup && !paymentFailed && !verifyFailed,
    providerError,
  });
}

export async function completeBookingWithOptionalRazorpay(
  saved: BookingSavedPayload,
  contact: { name?: string; email?: string; mobile?: string },
  tripTitle: string,
  travelDate: string,
  hooks?: BookingPaymentHooks
): Promise<{ paidAdvance: boolean; message: string }> {
  const bookingId = (saved.booking_id || "").trim();
  const refundDays = saved.advance_refund_days ?? 12;

  if (!bookingId || !saved.razorpay_enabled) {
    return {
      paidAdvance: false,
      message: `Your booking for ${tripTitle} on ${travelDate} is in. Our team will reach out shortly.`,
    };
  }

  const result = await payAdvanceForBooking(bookingId, contact, hooks);
  const advance = Number(result.advance_payment_inr ?? 0);
  const balance = Number(result.balance_due_inr ?? 0);
  document.getElementById("wbPayAlertModal")?.remove();
  return {
    paidAdvance: true,
    message: `Your seat is confirmed. Advance of ₹${advance.toLocaleString("en-IN")} received for ${tripTitle}. Balance due: ₹${balance.toLocaleString("en-IN")} before the trip. ${advanceRefundPolicyText(refundDays)}`,
  };
}
