import { API_BASE_URL, parseError, ROUTES, saveSession } from "./config.js";

const statusEl = document.getElementById("authStatus") as HTMLElement;

function showStatus(message: string, ok = false): void {
  statusEl.textContent = message;
  statusEl.style.color = ok ? "#3f6212" : "#b91c1c";
}

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = (tab as HTMLElement).dataset.tab;
    document.querySelectorAll(".auth-tab").forEach((btn) => btn.classList.remove("active"));
    document.querySelectorAll(".auth-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    if (target === "signup") {
      document.getElementById("signupPanel")?.classList.add("active");
    } else {
      document.getElementById("loginPanel")?.classList.add("active");
    }
    showStatus("");
  });
});

(document.getElementById("signupForm") as HTMLFormElement).addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawEmail = (document.getElementById("signupEmail") as HTMLInputElement).value.trim();
  const payload = {
    name: (document.getElementById("signupName") as HTMLInputElement).value.trim(),
    email: rawEmail,
    mobile: (document.getElementById("signupMobile") as HTMLInputElement).value.trim(),
    password: (document.getElementById("signupPassword") as HTMLInputElement).value,
  };

  if (!rawEmail) {
    showStatus("Email is required.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(await parseError(response, data));
    saveSession(data.token, data.user);
    showStatus("Account created! Redirecting to your dashboard...", true);
    setTimeout(() => {
      window.location.href = ROUTES.upcoming;
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
      window.location.href = ROUTES.upcoming;
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
  window.location.href = user.role === "admin" ? ROUTES.admin : ROUTES.upcoming;
}
