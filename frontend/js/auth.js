import { API_BASE_URL, parseError, saveSession } from "./config.js";
const statusEl = document.getElementById("authStatus");
function showStatus(message, ok = false) {
    statusEl.textContent = message;
    statusEl.style.color = ok ? "#3f6212" : "#b91c1c";
}
document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        document.querySelectorAll(".auth-tab").forEach((btn) => btn.classList.remove("active"));
        document.querySelectorAll(".auth-panel").forEach((panel) => panel.classList.remove("active"));
        tab.classList.add("active");
        if (target === "signup") {
            document.getElementById("signupPanel")?.classList.add("active");
        }
        else {
            document.getElementById("loginPanel")?.classList.add("active");
        }
        showStatus("");
    });
});
document.getElementById("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
        name: document.getElementById("signupName").value.trim(),
        email: document.getElementById("signupEmail").value.trim(),
        mobile: document.getElementById("signupMobile").value.trim(),
        password: document.getElementById("signupPassword").value,
    };
    try {
        const response = await fetch(`${API_BASE_URL}/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok)
            throw new Error(await parseError(response, data));
        saveSession(data.token, data.user);
        showStatus("Account created! Redirecting to your dashboard...", true);
        setTimeout(() => {
            window.location.href = "./user-dashboard.html";
        }, 900);
    }
    catch (error) {
        showStatus(error instanceof Error ? error.message : "Signup failed");
    }
});
document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
        identifier: document.getElementById("loginIdentifier").value.trim(),
        password: document.getElementById("loginPassword").value,
    };
    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok)
            throw new Error(await parseError(response, data));
        saveSession(data.token, data.user);
        if (data.user.role === "admin") {
            window.location.href = "./admin-dashboard.html";
            return;
        }
        showStatus("Logged in! Opening your dashboard...", true);
        setTimeout(() => {
            window.location.href = "./user-dashboard.html";
        }, 700);
    }
    catch (error) {
        showStatus(error instanceof Error ? error.message : "Login failed");
    }
});
// If already logged in, skip auth page
const token = localStorage.getItem("wb_token");
const userRaw = localStorage.getItem("wb_user");
if (token && userRaw) {
    const user = JSON.parse(userRaw);
    window.location.href = user.role === "admin" ? "./admin-dashboard.html" : "./user-dashboard.html";
}
