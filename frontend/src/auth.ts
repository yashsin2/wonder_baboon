import { API_BASE_URL, parseError, ROUTES, saveSession } from "./config.js";

/** ?next=/the-quibbler returns the user to where they came from; only same-site relative paths are honoured. */
function postLoginTarget(fallback: string): string {
  const next = new URLSearchParams(window.location.search).get("next") || "";
  return /^\/(?![/\\])[A-Za-z0-9/_\-?=&%.]*$/.test(next) ? next : fallback;
}


const statusEl = document.getElementById("authStatus") as HTMLElement;

function showStatus(message: string, ok = false): void {
  statusEl.textContent = message;
  statusEl.style.color = ok ? "#3f6212" : "#b91c1c";
}

const authTabsEl = document.querySelector(".auth-tabs") as HTMLElement | null;

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = (tab as HTMLElement).dataset.tab;
    document.querySelectorAll(".auth-tab").forEach((btn) => btn.classList.remove("active"));
    document.querySelectorAll(".auth-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    if (authTabsEl) authTabsEl.style.display = "";
    if (target === "signup") {
      document.getElementById("signupPanel")?.classList.add("active");
    } else {
      document.getElementById("loginPanel")?.classList.add("active");
    }
    showStatus("");
  });
});

document.getElementById("forgotPasswordLink")?.addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelectorAll(".auth-panel").forEach((panel) => panel.classList.remove("active"));
  document.getElementById("forgotPanel")?.classList.add("active");
  if (authTabsEl) authTabsEl.style.display = "none";
  showStatus("");
});

document.getElementById("backToLoginLink")?.addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelectorAll(".auth-panel").forEach((panel) => panel.classList.remove("active"));
  document.getElementById("loginPanel")?.classList.add("active");
  document.querySelectorAll(".auth-tab").forEach((btn) => btn.classList.remove("active"));
  document.querySelector('.auth-tab[data-tab="login"]')?.classList.add("active");
  if (authTabsEl) authTabsEl.style.display = "";
  showStatus("");
});

const signupEmailInput = document.getElementById("signupEmail") as HTMLInputElement;
const signupSendOtpBtn = document.getElementById("signupSendOtpBtn") as HTMLButtonElement;
const signupOtpField = document.getElementById("signupOtpField") as HTMLElement;
const signupOtpCodeInput = document.getElementById("signupOtpCode") as HTMLInputElement;
const signupVerifyOtpBtn = document.getElementById("signupVerifyOtpBtn") as HTMLButtonElement;
const signupVerifiedNote = document.getElementById("signupVerifiedNote") as HTMLElement;
const signupPostVerifyFields = document.getElementById("signupPostVerifyFields") as HTMLElement;

let otpSentForEmail = "";
let otpResendTimer: ReturnType<typeof setInterval> | null = null;

/** Survives a page refresh/navigation so a verified-but-not-yet-submitted signup doesn't
 * have to repeat OTP verification — only the backend-issued token is trusted either way. */
const SIGNUP_VERIFICATION_KEY = "wb_signup_verification";
let signupVerificationToken = "";

function loadSignupVerification(): { email: string; token: string } | null {
  try {
    const raw = sessionStorage.getItem(SIGNUP_VERIFICATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: unknown; token?: unknown };
    if (typeof parsed.email === "string" && typeof parsed.token === "string" && parsed.token) {
      return { email: parsed.email, token: parsed.token };
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

function saveSignupVerification(email: string, token: string): void {
  sessionStorage.setItem(SIGNUP_VERIFICATION_KEY, JSON.stringify({ email, token }));
}

function clearSignupVerification(): void {
  sessionStorage.removeItem(SIGNUP_VERIFICATION_KEY);
  signupVerificationToken = "";
}

function showSignupVerifiedState(email: string): void {
  signupEmailInput.value = email;
  signupEmailInput.disabled = true;
  signupSendOtpBtn.hidden = true;
  signupOtpField.hidden = true;
  signupVerifiedNote.hidden = false;
  signupPostVerifyFields.hidden = false;
}

function showSignupUnverifiedState(): void {
  signupEmailInput.disabled = false;
  signupSendOtpBtn.hidden = false;
  signupVerifiedNote.hidden = true;
  signupPostVerifyFields.hidden = true;
  signupOtpField.hidden = true;
}

document.getElementById("signupChangeEmailLink")?.addEventListener("click", (event) => {
  event.preventDefault();
  clearSignupVerification();
  otpSentForEmail = "";
  signupEmailInput.value = "";
  showSignupUnverifiedState();
  showStatus("");
  signupEmailInput.focus();
});

const restoredSignupVerification = loadSignupVerification();
if (restoredSignupVerification) {
  signupVerificationToken = restoredSignupVerification.token;
  showSignupVerifiedState(restoredSignupVerification.email);
}

function startOtpCooldown(seconds: number): void {
  if (otpResendTimer) clearInterval(otpResendTimer);
  let remaining = seconds;
  signupSendOtpBtn.disabled = true;
  signupSendOtpBtn.textContent = `Resend in ${remaining}s`;
  otpResendTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      if (otpResendTimer) clearInterval(otpResendTimer);
      otpResendTimer = null;
      signupSendOtpBtn.disabled = false;
      signupSendOtpBtn.textContent = "Resend code";
      return;
    }
    signupSendOtpBtn.textContent = `Resend in ${remaining}s`;
  }, 1000);
}

const forgotEmailInput = document.getElementById("forgotEmail") as HTMLInputElement;
const forgotSendOtpBtn = document.getElementById("forgotSendOtpBtn") as HTMLButtonElement;
const forgotOtpField = document.getElementById("forgotOtpField") as HTMLElement;
const forgotOtpCodeInput = document.getElementById("forgotOtpCode") as HTMLInputElement;
const forgotNewPasswordInput = document.getElementById("forgotNewPassword") as HTMLInputElement;

let forgotOtpSentForEmail = "";
let forgotResendTimer: ReturnType<typeof setInterval> | null = null;

function startForgotOtpCooldown(seconds: number): void {
  if (forgotResendTimer) clearInterval(forgotResendTimer);
  let remaining = seconds;
  forgotSendOtpBtn.disabled = true;
  forgotSendOtpBtn.textContent = `Resend in ${remaining}s`;
  forgotResendTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      if (forgotResendTimer) clearInterval(forgotResendTimer);
      forgotResendTimer = null;
      forgotSendOtpBtn.disabled = false;
      forgotSendOtpBtn.textContent = "Resend code";
      return;
    }
    forgotSendOtpBtn.textContent = `Resend in ${remaining}s`;
  }, 1000);
}

forgotSendOtpBtn.addEventListener("click", async () => {
  const email = forgotEmailInput.value.trim();
  if (!email || !email.includes("@")) {
    showStatus("Enter a valid email first.");
    return;
  }
  forgotSendOtpBtn.disabled = true;
  const originalLabel = forgotSendOtpBtn.textContent;
  forgotSendOtpBtn.textContent = "Sending…";
  try {
    const response = await fetch(`${API_BASE_URL}/auth/forgot-password/otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(await parseError(response, data));
    forgotOtpSentForEmail = email.toLowerCase();
    forgotOtpField.hidden = false;
    forgotOtpCodeInput.focus();
    showStatus("If an account exists for this email, a code has been sent.", true);
    startForgotOtpCooldown(60);
  } catch (error) {
    forgotSendOtpBtn.disabled = false;
    forgotSendOtpBtn.textContent = originalLabel;
    showStatus(error instanceof Error ? error.message : "Could not send verification code");
  }
});

(document.getElementById("forgotForm") as HTMLFormElement).addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawEmail = forgotEmailInput.value.trim();
  const otpCode = forgotOtpCodeInput.value.trim();
  const newPassword = forgotNewPasswordInput.value;

  if (!rawEmail) {
    showStatus("Email is required.");
    return;
  }
  if (forgotOtpSentForEmail !== rawEmail.toLowerCase()) {
    showStatus("Send a verification code to this email first.");
    return;
  }
  if (!/^\d{6}$/.test(otpCode)) {
    showStatus("Enter the 6-digit verification code sent to your email.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/forgot-password/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: rawEmail, otp_code: otpCode, new_password: newPassword }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(await parseError(response, data));
    showStatus("Password reset! You can log in now.", true);
    setTimeout(() => {
      document.getElementById("backToLoginLink")?.dispatchEvent(new Event("click"));
    }, 900);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not reset password");
  }
});

signupSendOtpBtn.addEventListener("click", async () => {
  const email = signupEmailInput.value.trim();
  if (!email || !email.includes("@")) {
    showStatus("Enter a valid email first.");
    return;
  }
  signupSendOtpBtn.disabled = true;
  const originalLabel = signupSendOtpBtn.textContent;
  signupSendOtpBtn.textContent = "Sending…";
  try {
    const response = await fetch(`${API_BASE_URL}/auth/signup/otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(await parseError(response, data));
    otpSentForEmail = email.toLowerCase();
    signupOtpField.hidden = false;
    signupOtpCodeInput.focus();
    showStatus("Verification code sent — check your email.", true);
    startOtpCooldown(60);
  } catch (error) {
    signupSendOtpBtn.disabled = false;
    signupSendOtpBtn.textContent = originalLabel;
    showStatus(error instanceof Error ? error.message : "Could not send verification code");
  }
});

signupVerifyOtpBtn.addEventListener("click", async () => {
  const email = signupEmailInput.value.trim();
  const otpCode = signupOtpCodeInput.value.trim();
  if (otpSentForEmail !== email.toLowerCase()) {
    showStatus("Send a verification code to this email first.");
    return;
  }
  if (!/^\d{6}$/.test(otpCode)) {
    showStatus("Enter the 6-digit verification code sent to your email.");
    return;
  }
  signupVerifyOtpBtn.disabled = true;
  const originalLabel = signupVerifyOtpBtn.textContent;
  signupVerifyOtpBtn.textContent = "Verifying…";
  try {
    const response = await fetch(`${API_BASE_URL}/auth/signup/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp_code: otpCode }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(await parseError(response, data));
    const verifiedEmail = email.toLowerCase();
    signupVerificationToken = data.verification_token;
    saveSignupVerification(verifiedEmail, signupVerificationToken);
    showSignupVerifiedState(verifiedEmail);
    showStatus("Email verified! Finish creating your account below.", true);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Could not verify code");
  } finally {
    signupVerifyOtpBtn.disabled = false;
    signupVerifyOtpBtn.textContent = originalLabel;
  }
});

(document.getElementById("signupForm") as HTMLFormElement).addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawEmail = signupEmailInput.value.trim();
  const payload = {
    name: (document.getElementById("signupName") as HTMLInputElement).value.trim(),
    email: rawEmail,
    mobile: (document.getElementById("signupMobile") as HTMLInputElement).value.trim(),
    password: (document.getElementById("signupPassword") as HTMLInputElement).value,
    verification_token: signupVerificationToken,
  };

  if (!rawEmail) {
    showStatus("Email is required.");
    return;
  }
  if (!signupVerificationToken) {
    showStatus("Verify your email first.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      const message = await parseError(response, data);
      if (response.status === 400) {
        // Verification token expired/invalid (e.g. long delay, or email already taken since
        // verifying) — reset to the OTP step instead of leaving the user stuck.
        clearSignupVerification();
        otpSentForEmail = "";
        showSignupUnverifiedState();
      }
      throw new Error(message);
    }
    clearSignupVerification();
    saveSession(data.token, data.user);
    showStatus("Account created! Redirecting to your dashboard...", true);
    setTimeout(() => {
      window.location.href = postLoginTarget(ROUTES.upcoming);
    }, 900);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Signup failed");
  }
});

(document.getElementById("loginForm") as HTMLFormElement).addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    identifier: (document.getElementById("loginIdentifier") as HTMLInputElement).value.trim(),
    password: (document.getElementById("loginPassword") as HTMLInputElement).value,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(await parseError(response, data));
    saveSession(data.token, data.user);

    if (data.user.role === "admin") {
      window.location.href = ROUTES.admin;
      return;
    }

    showStatus("Logged in! Opening your dashboard...", true);
    setTimeout(() => {
      window.location.href = postLoginTarget(ROUTES.upcoming);
    }, 700);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Login failed");
  }
});

// If already logged in, skip auth page
const token = localStorage.getItem("wb_token");
const userRaw = localStorage.getItem("wb_user");
if (token && userRaw) {
  const user = JSON.parse(userRaw) as { role?: string };
  window.location.href = user.role === "admin" ? ROUTES.admin : postLoginTarget(ROUTES.upcoming);
}
