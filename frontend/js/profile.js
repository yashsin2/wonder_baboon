import { API_BASE_URL, ROUTES, getSession, saveSession, parseError, showMessagePopup, mountWbModal, } from "./config.js?v=20261125144352";
const main = document.getElementById("profileMain");
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function safeUrl(value) {
    return /^https?:\/\//i.test(value) ? esc(value) : "";
}
function timeAgo(iso) {
    const then = Date.parse(iso);
    if (!Number.isFinite(then))
        return "";
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 60)
        return "now";
    if (s < 3600)
        return `${Math.floor(s / 60)}m`;
    if (s < 86400)
        return `${Math.floor(s / 3600)}h`;
    if (s < 86400 * 7)
        return `${Math.floor(s / 86400)}d`;
    return new Date(then).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
async function api(path, init = {}) {
    const { token } = getSession();
    const headers = {};
    if (init.body && !(init.body instanceof FormData))
        headers["Content-Type"] = "application/json";
    if (token)
        headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
    let data = null;
    try {
        data = await response.json();
    }
    catch {
        data = null;
    }
    if (!response.ok)
        throw new Error(await parseError(response, data));
    return data;
}
function postRowHtml(p) {
    const thumb = p.images[0]?.thumb ? safeUrl(p.images[0].thumb) : "";
    const cover = thumb
        ? `<div class="cf-photos cf-photos--1" style="max-width:120px"><div class="cf-photo"><img src="${thumb}" alt="" loading="lazy" decoding="async" /></div></div>`
        : "";
    return `<article class="cf-post" data-id="${esc(p.id)}">
    <div class="cf-avatar cf-avatar--sm" aria-hidden="true">${esc((p.authorName || "?").charAt(0).toUpperCase())}</div>
    <div class="cf-post-main">
      <div class="cf-post-head">
        <span class="cf-badge">${esc(p.mood)}</span>
        <span class="cf-meta">${esc(timeAgo(p.createdAt))} · ❤️ ${p.likeCount} · 💬 ${p.commentCount}</span>
        <span class="cf-head-spacer"></span>
        <button type="button" class="cf-more-btn" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="Post options">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
        </button>
        <div class="cf-menu" role="menu" hidden>
          <button type="button" role="menuitem" class="cf-menu-item" data-act="open">👁️ View story</button>
          <button type="button" role="menuitem" class="cf-menu-item" data-act="edit">✏️ Edit</button>
          <button type="button" role="menuitem" class="cf-menu-item cf-menu-item--danger" data-act="delete">🗑️ Delete</button>
        </div>
      </div>
      <h2 class="cf-title"><a class="cf-open" href="${ROUTES.ollivanders}?story=${encodeURIComponent(p.id)}">${esc(p.title)}</a></h2>
      ${cover}
      <p class="cf-excerpt">${esc(p.excerpt ?? "")}</p>
    </div>
  </article>`;
}
/** A cozy replacement for window.confirm() — resolves true/false, never blocks the thread. */
function confirmDialog(message, opts = {}) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            resolve(value);
        };
        const modal = document.createElement("div");
        modal.className = "cf-modal";
        modal.innerHTML = `<div class="cf-sheet cf-sheet--narrow" role="dialog" aria-modal="true">
      <h2>${esc(opts.title ?? "Are you sure?")}</h2>
      <p>${esc(message)}</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button type="button" class="cf-btn" data-sheet-close>Cancel</button>
        <button type="button" class="cf-btn ${opts.danger ? "cf-btn--danger" : "cf-btn--primary"}" data-confirm="yes">${esc(opts.confirmLabel ?? "Yes, I'm sure")}</button>
      </div>
    </div>`;
        const unmount = mountWbModal(modal);
        const close = () => {
            unmount();
            finish(false);
        };
        modal.addEventListener("mousedown", (event) => {
            if (event.target === modal)
                close();
        });
        modal.addEventListener("click", (event) => {
            const el = event.target;
            if (el.closest('[data-confirm="yes"]')) {
                finish(true);
                unmount();
            }
            else if (el.closest("[data-sheet-close]")) {
                close();
            }
        });
        document.addEventListener("keydown", function onKey(event) {
            if (event.key === "Escape") {
                document.removeEventListener("keydown", onKey);
                close();
            }
        });
    });
}
function errorText(error) {
    return error instanceof Error ? error.message.replace(/^value error,\s*/i, "") : "Something went wrong";
}
function renderLogin() {
    const next = encodeURIComponent("/profile");
    main.innerHTML = `
    <div class="cf-profile-section" style="text-align:center">
      <h2>Log in to see your profile</h2>
      <p class="cf-meta">Your stories, likes, and settings live here.</p>
      <p><a class="cf-btn cf-btn--primary" style="display:inline-flex;margin-top:12px" href="/auth?next=${next}">Log in / Sign up</a></p>
    </div>`;
}
async function render(profile) {
    const nameInit = profile.name || "";
    main.innerHTML = `
    <section class="cf-profile-head">
      <div class="cf-avatar" aria-hidden="true">${esc((nameInit || "?").charAt(0).toUpperCase())}</div>
      <div class="cf-profile-info">
        <h1 id="pfName">${esc(nameInit || "Your profile")}</h1>
        <p>${esc(profile.email || "")}</p>
      </div>
    </section>

    <section class="cf-profile-section">
      <h2>Edit your profile</h2>
      <form class="cf-profile-form" id="pfForm" autocomplete="off">
        <label for="pfNameInput">Display name</label>
        <input id="pfNameInput" type="text" value="${esc(nameInit)}" maxlength="80" />
        <label for="pfEmailInput">Email</label>
        <input id="pfEmailInput" type="email" value="${esc(profile.email || "")}" disabled />
        <div style="display:flex;gap:10px;margin-top:8px">
          <button type="submit" class="cf-btn cf-btn--primary" id="pfSave">Save changes</button>
          <a class="cf-btn" href="/settings">Advanced settings</a>
        </div>
        <small class="cf-meta">To change your email or mobile, use advanced settings.</small>
      </form>
    </section>

    <section class="cf-profile-section" style="padding-bottom:12px">
      <h2>Your Quibbler stories</h2>
      <p class="cf-meta" style="margin-top:-8px">Tap the three dots on a story to edit or delete it.</p>
    </section>
    <div class="cf-profile-posts" id="pfPosts"></div>
    <div id="pfStoriesStatus" class="cf-status" aria-live="polite">Loading your stories…</div>`;
    const form = document.getElementById("pfForm");
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const nameInput = document.getElementById("pfNameInput");
        const name = nameInput.value.trim();
        if (!name) {
            showMessagePopup("Please enter a display name", "error");
            return;
        }
        const btn = document.getElementById("pfSave");
        btn.disabled = true;
        btn.textContent = "Saving…";
        api("/user/profile", { method: "PATCH", body: JSON.stringify({ name }) })
            .then(() => {
            const session = getSession();
            if (session.token && session.user)
                saveSession(session.token, { ...session.user, name });
            document.getElementById("pfName").textContent = name;
            showMessagePopup("Name updated");
        })
            .catch((error) => showMessagePopup(errorText(error), "error"))
            .finally(() => {
            btn.disabled = false;
            btn.textContent = "Save changes";
        });
    });
    await loadStories();
}
async function loadStories() {
    const listEl = document.getElementById("pfPosts");
    const statusEl = document.getElementById("pfStoriesStatus");
    try {
        const data = await api("/blog?mine=1&limit=24");
        const posts = data.posts ?? [];
        if (!posts.length) {
            listEl.innerHTML = `
        <div class="cf-empty-stories">
          <h3 style="margin:0 0 6px;font-family:var(--cf-display)">No stories yet</h3>
          <p>Light the first fire — write a story and it'll show up here.</p>
          <a href="${ROUTES.theQuibbler}" class="cf-btn cf-btn--primary" style="display:inline-flex">Write a story</a>
        </div>`;
            statusEl.textContent = "";
            return;
        }
        listEl.innerHTML = posts.map(postRowHtml).join("");
        statusEl.textContent = posts.length === 1 ? "1 story" : `${posts.length} stories`;
    }
    catch (error) {
        statusEl.innerHTML = `<p>${esc(errorText(error))}</p>`;
    }
}
function closeAllMenus(except) {
    document.querySelectorAll(".cf-menu").forEach((m) => {
        if (m !== except) {
            m.hidden = true;
            const btn = m.previousElementSibling;
            btn?.setAttribute("aria-expanded", "false");
        }
    });
}
main.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act]");
    const card = event.target.closest(".cf-post");
    if (!target || !card)
        return;
    const id = card.dataset.id || "";
    switch (target.dataset.act) {
        case "menu": {
            const menu = card.querySelector(".cf-menu");
            if (!menu)
                return;
            const show = menu.hidden;
            closeAllMenus();
            menu.hidden = !show;
            target.setAttribute("aria-expanded", String(show));
            break;
        }
        case "open":
            window.location.href = `${ROUTES.ollivanders}?story=${encodeURIComponent(id)}`;
            break;
        case "edit":
            // Take the user straight to the story on The Quibbler with an edit flag.
            window.location.href = `${ROUTES.ollivanders}?story=${encodeURIComponent(id)}&edit=1`;
            break;
        case "delete":
            confirmDialog("This removes the story, its photos, and every like, comment and save on it. This cannot be undone.", {
                title: "Delete this story?",
                confirmLabel: "Delete story",
                danger: true,
            }).then((ok) => {
                if (!ok)
                    return;
                api(`/blog/${id}`, { method: "DELETE" })
                    .then(() => {
                    card.remove();
                    showMessagePopup("Story deleted");
                    if (!document.querySelectorAll(".cf-profile-posts .cf-post").length)
                        void loadStories();
                })
                    .catch((error) => showMessagePopup(errorText(error), "error"));
            });
            break;
    }
});
document.addEventListener("click", (event) => {
    if (!event.target.closest(".cf-menu, .cf-more-btn"))
        closeAllMenus();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape")
        closeAllMenus();
});
async function boot() {
    const { token, user } = getSession();
    if (!token || user?.role !== "user") {
        renderLogin();
        return;
    }
    try {
        const profile = await api("/user/profile");
        await render(profile);
    }
    catch (error) {
        main.innerHTML = `<div class="cf-status"><p>${esc(errorText(error))}</p></div>`;
    }
}
void boot();
