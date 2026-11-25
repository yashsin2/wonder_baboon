import { API_BASE_URL, getSession, mountWbModal, parseError, showMessagePopup } from "./config.js";
const MOODS = ["Emotional", "Funny", "Adventure", "Food", "Soul-searching", "Budget tips"];
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const BODY_MIN = 50;
const BODY_MAX = 10000;
const $ = (id) => document.getElementById(id);
const postsEl = $("cfPosts");
const statusEl = $("cfStatus");
const sentinelEl = $("cfSentinel");
const moodsEl = $("cfMoods");
const viewTitleEl = $("cfViewTitle");
let view = "explore";
let mood = "All";
let cursor = "";
let loading = false;
let done = false;
let loadToken = 0;
const cache = new Map();
const ICON = {
    heart: `<svg width="20" height="20" viewBox="0 0 24 24" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 018-3 4.6 4.6 0 018 3c0 5.8-8 11-8 11z"/></svg>`,
    comment: `<svg width="20" height="20" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12z"/></svg>`,
    share: `<svg width="20" height="20" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v14"/></svg>`,
    save: `<svg width="20" height="20" viewBox="0 0 24 24" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z"/></svg>`,
    pin: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
    bell: `<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>`,
    photo: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>`,
    more: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`,
};
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
/** Only ever put server-provided URLs into src after checking they are http(s). */
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
    if (s < 86400 * 30)
        return `${Math.floor(s / (86400 * 7))}w`;
    return new Date(then).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function isUser() {
    const { token, user } = getSession();
    return Boolean(token && user?.role === "user");
}
function isAdmin() {
    const { token, user } = getSession();
    return Boolean(token && user?.role === "admin");
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
function errorText(error) {
    return error instanceof Error ? error.message.replace(/^value error,\s*/i, "") : "Something went wrong";
}
const openSheets = [];
function openSheet(html, opts = {}) {
    const modal = document.createElement("div");
    modal.className = "cf-modal";
    modal.innerHTML = `<div class="cf-sheet${opts.narrow ? " cf-sheet--narrow" : ""}" role="dialog" aria-modal="true">${html}</div>`;
    const unmount = mountWbModal(modal);
    const sheet = modal.firstElementChild;
    let closed = false;
    let guardPending = false;
    const finishClose = () => {
        closed = true;
        document.removeEventListener("keydown", onKey);
        openSheets.splice(openSheets.indexOf(result), 1);
        unmount();
        opts.onClose?.();
    };
    const close = () => {
        if (closed || guardPending)
            return;
        if (!opts.guard) {
            finishClose();
            return;
        }
        const allowed = opts.guard();
        if (allowed instanceof Promise) {
            guardPending = true;
            allowed
                .then((ok) => {
                guardPending = false;
                if (ok)
                    finishClose();
            })
                .catch(() => {
                guardPending = false;
            });
            return;
        }
        if (allowed)
            finishClose();
    };
    const onKey = (event) => {
        if (event.key === "Escape" && openSheets[openSheets.length - 1] === result)
            close();
    };
    document.addEventListener("keydown", onKey);
    modal.addEventListener("mousedown", (event) => {
        if (event.target === modal)
            close();
    });
    modal.addEventListener("click", (event) => {
        if (event.target.closest("[data-sheet-close]"))
            close();
    });
    const result = { modal, sheet, close };
    openSheets.push(result);
    sheet.querySelector("[data-sheet-close]")?.focus();
    return result;
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
        const s = openSheet(`<h2>${esc(opts.title ?? "Are you sure?")}</h2>
       <p>${esc(message)}</p>
       <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
         <button type="button" class="cf-btn" data-sheet-close>Cancel</button>
         <button type="button" class="cf-btn ${opts.danger ? "cf-btn--danger" : "cf-btn--primary"}" data-confirm="yes">${esc(opts.confirmLabel ?? "Yes, I'm sure")}</button>
       </div>`, { narrow: true, onClose: () => finish(false) });
        s.sheet.addEventListener("click", (event) => {
            if (event.target.closest('[data-confirm="yes"]')) {
                finish(true);
                s.close();
            }
        });
    });
}
function showLogin(action) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    const s = openSheet(`<h2>Join the circle</h2>
     <p>Log in to ${esc(action)}. It only takes a minute.</p>
     <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
       <button type="button" class="cf-btn" data-sheet-close>Not now</button>
       <a class="cf-btn cf-btn--primary" href="/auth?next=${next}">Log in / Sign up</a>
     </div>`, { narrow: true });
    void s;
}
function requireUser(action) {
    if (isUser())
        return true;
    if (isAdmin()) {
        showMessagePopup("Admins can't post as travellers. Please use a traveller account.", "error");
        return false;
    }
    showLogin(action);
    return false;
}
/* ---------- feed ---------- */
function photosHtml(post) {
    const imgs = post.images;
    if (!imgs.length)
        return "";
    const shown = imgs.slice(0, 4);
    const extra = imgs.length - shown.length;
    const tiles = shown
        .map((img, i) => {
        const more = i === shown.length - 1 && extra > 0 ? `<span class="cf-photo-count">+${extra}</span>` : "";
        return `<button type="button" class="cf-photo" data-act="open" data-index="${i}" aria-label="Open photo ${i + 1} of ${imgs.length}">
        <img src="${safeUrl(img.thumb)}" alt="${esc(img.caption || post.title)}" width="${num(img.w)}" height="${num(img.h)}" loading="lazy" decoding="async" />${more}
      </button>`;
    })
        .join("");
    return `<div class="cf-photos cf-photos--${shown.length}">${tiles}</div>`;
}
function postHtml(p) {
    const excerpt = esc(p.excerpt ?? "");
    const ownMenu = p.mine
        ? `<span class="cf-head-spacer"></span>
       <button type="button" class="cf-more-btn" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="Post options">${ICON.more}</button>
       <div class="cf-menu" role="menu" hidden>
         <button type="button" role="menuitem" class="cf-menu-item" data-act="edit">✏️ Edit story</button>
         <button type="button" role="menuitem" class="cf-menu-item cf-menu-item--danger" data-act="delete">🗑️ Delete</button>
       </div>`
        : `<span class="cf-head-spacer"></span>
       <button type="button" class="cf-bell-btn${p.followingAuthor ? " is-on" : ""}" data-act="follow" aria-pressed="${p.followingAuthor}" aria-label="${p.followingAuthor ? `Following ${p.authorName}` : `Follow ${p.authorName} for new stories`}" title="${p.followingAuthor ? "Following — get an email on their next story" : "Get an email when they post"}">${ICON.bell}</button>`;
    return `<article class="cf-post" data-id="${esc(p.id)}">
    <div class="cf-avatar cf-avatar--sm" aria-hidden="true">${esc((p.authorName || "?").charAt(0).toUpperCase())}</div>
    <div class="cf-post-main">
      <div class="cf-post-head">
        <span class="cf-author">${esc(p.authorName)}</span>
        <span class="cf-meta">${esc(p.authorHandle)} · ${esc(timeAgo(p.createdAt))}</span>
        <span class="cf-badge">${esc(p.mood)}</span>
        ${ownMenu}
      </div>
      ${p.place ? `<div class="cf-place">${ICON.pin}${esc(p.place)}</div>` : ""}
      <h2 class="cf-title"><button type="button" class="cf-open" data-act="open">${esc(p.title)}</button></h2>
      ${photosHtml(p)}
      <p class="cf-excerpt">${excerpt}${p.truncated ? ` <button type="button" class="cf-open cf-more" data-act="open">Read more</button>` : ""}</p>
      <div class="cf-actions">
        <button type="button" class="cf-act cf-act--like${p.likedByMe ? " is-on" : ""}" data-act="like" aria-pressed="${p.likedByMe}" aria-label="Like">${ICON.heart}<span>${num(p.likeCount)}</span></button>
        <button type="button" class="cf-act" data-act="comments" aria-label="Comments">${ICON.comment}<span>${num(p.commentCount)}</span></button>
        <button type="button" class="cf-act" data-act="share" aria-label="Share">${ICON.share}</button>
        <span class="cf-spacer"></span>
        <button type="button" class="cf-act cf-act--save${p.savedByMe ? " is-on" : ""}" data-act="save" aria-pressed="${p.savedByMe}" aria-label="Save">${ICON.save}</button>
      </div>
    </div>
  </article>`;
}
function skeletons(n = 3) {
    return Array.from({ length: n })
        .map(() => `<div class="cf-skel" aria-hidden="true"><div class="cf-skel-dot"></div><div class="cf-skel-lines">
        <div class="cf-skel-line" style="width:40%"></div><div class="cf-skel-line" style="width:75%;height:20px"></div>
        <div class="cf-skel-line"></div><div class="cf-skel-line" style="width:85%"></div></div></div>`)
        .join("");
}
function renderEmpty() {
    const saved = view === "saved";
    statusEl.innerHTML = `<div class="cf-empty"><h2>${saved ? "Nothing saved yet" : "No stories here yet"}</h2>
    <p>${saved ? "Tap the bookmark on a story to keep it here." : "Be the first to light this fire."}</p>
    ${saved ? "" : `<button type="button" id="cfEmptyWrite">Write a story</button>`}</div>`;
    document.getElementById("cfEmptyWrite")?.addEventListener("click", () => openComposer());
}
async function loadMore(reset = false) {
    if (reset) {
        loadToken += 1;
        cursor = "";
        done = false;
        loading = false;
        postsEl.innerHTML = "";
        statusEl.innerHTML = "";
    }
    if (loading || done)
        return;
    loading = true;
    const token = loadToken;
    const skel = document.createElement("div");
    skel.innerHTML = skeletons(cache.size === 0 || reset ? 3 : 1);
    postsEl.appendChild(skel);
    try {
        const params = new URLSearchParams({ limit: "12", sort: view === "explore" ? "loved" : "latest" });
        if (mood !== "All")
            params.set("mood", mood);
        if (cursor)
            params.set("cursor", cursor);
        if (view === "saved")
            params.set("saved", "true");
        const data = await api(`/blog?${params.toString()}`);
        if (token !== loadToken)
            return;
        skel.remove();
        const items = data.posts ?? [];
        items.forEach((p) => cache.set(p.id, p));
        postsEl.insertAdjacentHTML("beforeend", items.map(postHtml).join(""));
        cursor = data.nextCursor;
        done = !cursor;
        if (!postsEl.children.length)
            renderEmpty();
        else if (done)
            statusEl.textContent = "You've reached the end of the trail.";
    }
    catch (error) {
        if (token !== loadToken)
            return;
        skel.remove();
        statusEl.innerHTML = `<div>${esc(errorText(error))}<br /><button type="button" id="cfRetry">Try again</button></div>`;
        document.getElementById("cfRetry")?.addEventListener("click", () => {
            statusEl.innerHTML = "";
            void loadMore();
        });
    }
    finally {
        if (token === loadToken)
            loading = false;
    }
}
function refreshCard(id, pop) {
    const p = cache.get(id);
    const el = postsEl.querySelector(`.cf-post[data-id="${CSS.escape(id)}"]`);
    if (!p || !el)
        return;
    el.outerHTML = postHtml(p);
    if (pop) {
        const btn = postsEl.querySelector(`.cf-post[data-id="${CSS.escape(id)}"] [data-act="${pop}"]`);
        btn?.classList.add("is-pop");
    }
}
async function toggleLike(id, onChange) {
    if (!requireUser("like stories"))
        return;
    const p = cache.get(id);
    if (!p)
        return;
    const prev = { liked: p.likedByMe, count: p.likeCount };
    p.likedByMe = !p.likedByMe;
    p.likeCount = Math.max(0, p.likeCount + (p.likedByMe ? 1 : -1));
    refreshCard(id, "like");
    onChange?.();
    try {
        const res = await api(`/blog/${id}/like`, { method: "POST" });
        p.likedByMe = res.liked;
        p.likeCount = res.likeCount;
    }
    catch (error) {
        p.likedByMe = prev.liked;
        p.likeCount = prev.count;
        showMessagePopup(errorText(error), "error");
    }
    refreshCard(id);
    onChange?.();
}
async function toggleSave(id, onChange) {
    if (!requireUser("save stories"))
        return;
    const p = cache.get(id);
    if (!p)
        return;
    const prev = p.savedByMe;
    p.savedByMe = !prev;
    refreshCard(id, "save");
    onChange?.();
    try {
        const res = await api(`/blog/${id}/save`, { method: "POST" });
        p.savedByMe = res.saved;
        if (view === "saved" && !res.saved)
            postsEl.querySelector(`.cf-post[data-id="${CSS.escape(id)}"]`)?.remove();
        if (view === "saved" && !postsEl.children.length)
            renderEmpty();
    }
    catch (error) {
        p.savedByMe = prev;
        showMessagePopup(errorText(error), "error");
    }
    refreshCard(id);
    onChange?.();
}
async function toggleFollow(id, onChange) {
    if (!requireUser("follow a storyteller"))
        return;
    const p = cache.get(id);
    if (!p)
        return;
    const prev = p.followingAuthor;
    p.followingAuthor = !prev;
    refreshCard(id);
    onChange?.();
    try {
        const res = await api(`/blog/${id}/follow`, { method: "POST" });
        p.followingAuthor = res.following;
        showMessagePopup(res.following ? `You'll get an email when ${p.authorName} posts next` : `Unfollowed ${p.authorName}`);
    }
    catch (error) {
        p.followingAuthor = prev;
        showMessagePopup(errorText(error), "error");
    }
    refreshCard(id);
    onChange?.();
}
async function sharePost(id) {
    const url = `${window.location.origin}/the-quibbler?story=${encodeURIComponent(id)}`;
    const title = cache.get(id)?.title ?? "The Quibbler";
    if (navigator.share) {
        try {
            await navigator.share({ title, url });
            return;
        }
        catch {
            /* user cancelled or share failed: fall through to copy */
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        showMessagePopup("Link copied");
    }
    catch {
        openSheet(`<h2>Copy this link</h2>
       <p>Your browser blocked the one-tap copy — select the link below and copy it manually.</p>
       <input type="text" readonly value="${esc(url)}" style="width:100%;padding:12px 14px;border:1px solid var(--cf-border);border-radius:10px;background:#fff;color:var(--cf-text);font-size:14px;text-align:center;margin-bottom:16px" onclick="this.select()" />
       <button type="button" class="cf-btn cf-btn--primary" data-sheet-close>Done</button>`, { narrow: true });
    }
}
function closeAllMenus(except) {
    postsEl.querySelectorAll(".cf-menu").forEach((m) => {
        if (m !== except) {
            m.hidden = true;
            const btn = m.previousElementSibling;
            btn?.setAttribute("aria-expanded", "false");
        }
    });
}
async function deletePost(id) {
    const ok = await confirmDialog("This removes the story, its photos, and every like, comment and save on it. This cannot be undone.", {
        title: "Delete this story?",
        confirmLabel: "Delete story",
        danger: true,
    });
    if (!ok)
        return;
    try {
        await api(`/blog/${id}`, { method: "DELETE" });
        cache.delete(id);
        postsEl.querySelector(`.cf-post[data-id="${CSS.escape(id)}"]`)?.remove();
        showMessagePopup("Story deleted");
        if (!postsEl.children.length)
            renderEmpty();
    }
    catch (error) {
        showMessagePopup(errorText(error), "error");
    }
}
async function editPost(id) {
    let full;
    try {
        full = (await api(`/blog/${encodeURIComponent(id)}`)).post;
    }
    catch (error) {
        showMessagePopup(errorText(error), "error");
        return;
    }
    cache.set(full.id, { ...(cache.get(full.id) ?? full), ...full });
    openComposer(full);
}
postsEl.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act]");
    const card = event.target.closest(".cf-post");
    if (!target || !card)
        return;
    const id = card.dataset.id || "";
    switch (target.dataset.act) {
        case "like":
            void toggleLike(id);
            break;
        case "save":
            void toggleSave(id);
            break;
        case "follow":
            void toggleFollow(id);
            break;
        case "share":
            void sharePost(id);
            break;
        case "comments":
            void openReader(id, { focusComments: true });
            break;
        case "open":
            void openReader(id, { photoIndex: Number(target.dataset.index || 0) });
            break;
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
        case "edit":
            closeAllMenus();
            void editPost(id);
            break;
        case "delete":
            closeAllMenus();
            void deletePost(id);
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
/* ---------- reader ---------- */
function commentHtml(c, isReply) {
    const replies = (c.replies ?? []).map((r) => commentHtml(r, true)).join("");
    const total = num(c.replyCount);
    const hidden = total - (c.replies?.length ?? 0);
    return `<div class="cf-comment-wrap" data-cid="${esc(c.id)}">
    <div class="cf-comment">
      <div class="cf-avatar" aria-hidden="true">${esc((c.authorName || "?").charAt(0).toUpperCase())}</div>
      <div class="cf-comment-main">
        <div class="cf-comment-head"><strong>${esc(c.authorName)}</strong>${c.isStoryAuthor ? `<span class="cf-tag">Author</span>` : ""}<span class="cf-meta">${esc(timeAgo(c.createdAt))}</span></div>
        <p class="cf-comment-body">${esc(c.body)}</p>
        <div class="cf-comment-tools">
          ${isReply ? "" : `<button type="button" class="cf-link-btn" data-c="reply" data-name="${esc(c.authorName)}">Reply</button>`}
          ${c.canDelete ? `<button type="button" class="cf-link-btn" data-c="delete">Delete</button>` : ""}
          ${!c.mine ? `<button type="button" class="cf-link-btn" data-c="report">Report</button>` : ""}
        </div>
      </div>
    </div>
    ${isReply ? "" : `<div class="cf-replies" data-replies>${replies}${hidden > 0 ? `<button type="button" class="cf-link-btn" data-c="more-replies" data-count="${hidden}">View ${hidden} more repl${hidden === 1 ? "y" : "ies"}</button>` : ""}</div>`}
  </div>`;
}
async function openReader(id, opts = {}) {
    const url = new URL(window.location.href);
    url.searchParams.set("story", id);
    window.history.pushState(null, "", url.pathname + url.search);
    const s = openSheet(`<div class="cf-status">Opening story…</div>`, {
        onClose: () => {
            const u = new URL(window.location.href);
            if (u.searchParams.has("story")) {
                u.searchParams.delete("story");
                window.history.replaceState(null, "", u.pathname + u.search);
            }
        },
    });
    let post;
    try {
        post = (await api(`/blog/${encodeURIComponent(id)}`)).post;
    }
    catch (error) {
        s.sheet.innerHTML = `<div class="cf-form"><h2>Story not found</h2><p>${esc(errorText(error))}</p><button type="button" class="cf-btn" data-sheet-close>Close</button></div>`;
        return;
    }
    cache.set(post.id, { ...(cache.get(post.id) ?? post), ...post });
    const p = cache.get(post.id);
    const paragraphs = (post.body ?? "")
        .split(/\n{2,}/)
        .map((t) => `<p>${esc(t).replace(/\n/g, "<br />")}</p>`)
        .join("");
    const gallery = post.images.length
        ? `<div class="cf-reader-gallery" id="cfGallery">${post.images
            .map((img, i) => `<figure><img src="${safeUrl(img.full)}" alt="${esc(img.caption || post.title)}" width="${num(img.w)}" height="${num(img.h)}" ${i === 0 ? "" : 'loading="lazy"'} decoding="async" />${img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : ""}</figure>`)
            .join("")}</div>`
        : "";
    s.sheet.innerHTML = `
    <div class="cf-sheet-head"><span class="cf-badge">${esc(post.mood)}</span><span class="cf-meta" style="flex:1">${post.place ? esc(post.place) : ""}</span><button type="button" class="cf-close" data-sheet-close aria-label="Close story">&times;</button></div>
    ${gallery}
    <div class="cf-reader-body">
      <h1>${esc(post.title)}</h1>
      <div class="cf-byline"><div class="cf-avatar" aria-hidden="true">${esc((post.authorName || "?").charAt(0).toUpperCase())}</div>
        <div class="cf-byline-text"><strong>${esc(post.authorName)}</strong><span class="cf-meta">${num(post.readMinutes)} min read · ${esc(timeAgo(post.createdAt))} ago</span></div></div>
      <div class="cf-story">${paragraphs}</div>
    </div>
    <div class="cf-reader-actions" id="cfReaderActions"></div>
    <section class="cf-comments" id="cfComments" aria-label="Comments"></section>`;
    const gal = s.sheet.querySelector("#cfGallery");
    if (gal && opts.photoIndex)
        gal.scrollLeft = gal.clientWidth * opts.photoIndex;
    const actionsEl = s.sheet.querySelector("#cfReaderActions");
    const renderActions = () => {
        actionsEl.innerHTML = `
      <button type="button" class="cf-act cf-act--like${p.likedByMe ? " is-on" : ""}" data-r="like" aria-pressed="${p.likedByMe}">${ICON.heart}<span>${num(p.likeCount)}</span></button>
      <button type="button" class="cf-act cf-act--save${p.savedByMe ? " is-on" : ""}" data-r="save" aria-pressed="${p.savedByMe}" aria-label="Save">${ICON.save}</button>
      <button type="button" class="cf-act" data-r="share" aria-label="Share">${ICON.share}</button>
      ${!p.mine ? `<button type="button" class="cf-bell-btn${p.followingAuthor ? " is-on" : ""}" data-r="follow" aria-pressed="${p.followingAuthor}" aria-label="${p.followingAuthor ? `Following ${p.authorName}` : `Follow ${p.authorName}`}" title="${p.followingAuthor ? "Following — get an email on their next story" : "Get an email when they post"}">${ICON.bell}</button>` : ""}
      <span class="cf-spacer"></span>
      ${p.mine || isAdmin() ? `<button type="button" class="cf-link-btn" data-r="delete">Delete story</button>` : `<button type="button" class="cf-link-btn" data-r="report">Report</button>`}`;
    };
    renderActions();
    actionsEl.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-r]");
        if (!btn)
            return;
        const act = btn.dataset.r;
        if (act === "like")
            void toggleLike(id, renderActions);
        else if (act === "save")
            void toggleSave(id, renderActions);
        else if (act === "follow")
            void toggleFollow(id, renderActions);
        else if (act === "share")
            void sharePost(id);
        else if (act === "report")
            void reportItem("story", `/blog/${id}/report`);
        else if (act === "delete") {
            confirmDialog("This removes the story, its photos, and every like, comment and save on it. This cannot be undone.", {
                title: "Delete this story?",
                confirmLabel: "Delete story",
                danger: true,
            }).then((ok) => {
                if (!ok)
                    return;
                api(`/blog/${id}`, { method: "DELETE" })
                    .then(() => {
                    cache.delete(id);
                    postsEl.querySelector(`.cf-post[data-id="${CSS.escape(id)}"]`)?.remove();
                    s.close();
                    showMessagePopup("Story deleted");
                    if (!postsEl.children.length)
                        renderEmpty();
                })
                    .catch((error) => showMessagePopup(errorText(error), "error"));
            });
        }
    });
    void mountComments(s, p, opts.focusComments === true);
}
async function reportItem(kind, path) {
    if (!requireUser(`report this ${kind}`))
        return;
    const ok = await confirmDialog(`Report this ${kind} as inappropriate? Our team will take a look.`, { title: "Report this?", confirmLabel: "Report" });
    if (!ok)
        return;
    try {
        await api(path, { method: "POST", body: JSON.stringify({ reason: "" }) });
        showMessagePopup("Thanks. We'll take a look.");
    }
    catch (error) {
        showMessagePopup(errorText(error), "error");
    }
}
async function mountComments(s, p, focus) {
    const root = s.sheet.querySelector("#cfComments");
    let nextCursor = "";
    let replyTo = null;
    const countLabel = () => `Comments (${num(p.commentCount)})`;
    root.innerHTML = `<h3 id="cfCommentsTitle">${countLabel()}</h3><div id="cfCommentForm"></div><div id="cfCommentList"></div><div id="cfCommentMore"></div>`;
    const formEl = root.querySelector("#cfCommentForm");
    const listEl = root.querySelector("#cfCommentList");
    const moreEl = root.querySelector("#cfCommentMore");
    const titleEl = root.querySelector("#cfCommentsTitle");
    const syncCount = () => {
        titleEl.textContent = countLabel();
        refreshCard(p.id);
    };
    const renderForm = () => {
        if (!isUser()) {
            const next = encodeURIComponent(window.location.pathname + window.location.search);
            formEl.innerHTML = `<div class="cf-login-hint"><a href="/auth?next=${next}">Log in</a> to join the conversation.</div>`;
            return;
        }
        formEl.innerHTML = `<form class="cf-comment-form" id="cfCForm">
      ${replyTo ? `<div class="cf-meta">Replying to ${esc(replyTo.name)} <button type="button" class="cf-link-btn" data-c="cancel-reply">Cancel</button></div>` : ""}
      <textarea id="cfCText" maxlength="1000" placeholder="${replyTo ? "Write a reply…" : "Share a thought…"}" aria-label="Comment"></textarea>
      <div class="cf-comment-form-row"><small id="cfCCount">0 / 1000</small><button type="submit" class="cf-btn cf-btn--primary">${replyTo ? "Reply" : "Comment"}</button></div>
    </form>`;
        const ta = formEl.querySelector("#cfCText");
        ta.addEventListener("input", () => {
            formEl.querySelector("#cfCCount").textContent = `${ta.value.length} / 1000`;
        });
        formEl.querySelector("#cfCForm").addEventListener("submit", (event) => {
            event.preventDefault();
            const text = ta.value.trim();
            if (!text)
                return;
            const submit = formEl.querySelector("button[type=submit]");
            submit.disabled = true;
            api(`/blog/${p.id}/comments`, {
                method: "POST",
                body: JSON.stringify({ body: text, parentId: replyTo?.id ?? null }),
            })
                .then(({ comment }) => {
                const withTools = { ...comment, replyCount: 0, replies: [] };
                if (replyTo) {
                    const holder = listEl.querySelector(`[data-cid="${CSS.escape(replyTo.id)}"] [data-replies]`);
                    holder?.insertAdjacentHTML("beforeend", commentHtml(withTools, true));
                }
                else {
                    listEl.insertAdjacentHTML("afterbegin", commentHtml(withTools, false));
                }
                p.commentCount += 1;
                replyTo = null;
                syncCount();
                renderForm();
            })
                .catch((error) => {
                showMessagePopup(errorText(error), "error");
                submit.disabled = false;
            });
        });
    };
    const loadComments = async () => {
        moreEl.innerHTML = "";
        try {
            const q = new URLSearchParams({ limit: "10" });
            if (nextCursor)
                q.set("cursor", nextCursor);
            const data = await api(`/blog/${p.id}/comments?${q.toString()}`);
            const items = data.comments ?? [];
            listEl.insertAdjacentHTML("beforeend", items.map((c) => commentHtml(c, false)).join(""));
            nextCursor = data.nextCursor;
            if (!listEl.children.length)
                listEl.innerHTML = `<p class="cf-meta" id="cfNoComments">No comments yet. Say something kind.</p>`;
            else
                listEl.querySelector("#cfNoComments")?.remove();
            if (nextCursor)
                moreEl.innerHTML = `<button type="button" class="cf-link-btn" data-c="more">Show more comments</button>`;
        }
        catch (error) {
            moreEl.innerHTML = `<span class="cf-form-error">${esc(errorText(error))}</span>`;
        }
    };
    root.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-c]");
        if (!btn)
            return;
        const wrap = btn.closest("[data-cid]");
        const cid = wrap?.dataset.cid ?? "";
        switch (btn.dataset.c) {
            case "more":
                void loadComments();
                break;
            case "reply":
                if (!requireUser("reply"))
                    return;
                replyTo = { id: cid, name: btn.dataset.name || "" };
                renderForm();
                formEl.querySelector("textarea")?.focus();
                break;
            case "cancel-reply":
                replyTo = null;
                renderForm();
                break;
            case "more-replies": {
                const holder = wrap?.querySelector("[data-replies]");
                if (!holder)
                    return;
                btn.textContent = "Loading…";
                api(`/blog/${p.id}/comments?parentId=${encodeURIComponent(cid)}&limit=30`)
                    .then((data) => {
                    holder.innerHTML = (data.comments ?? []).map((c) => commentHtml(c, true)).join("");
                })
                    .catch((error) => showMessagePopup(errorText(error), "error"));
                break;
            }
            case "delete":
                confirmDialog("Delete this comment? Any replies under it go too.", { title: "Delete comment?", confirmLabel: "Delete", danger: true }).then((ok) => {
                    if (!ok)
                        return;
                    api(`/blog/comments/${cid}`, { method: "DELETE" })
                        .then((res) => {
                        wrap?.remove();
                        p.commentCount = Math.max(0, p.commentCount - num(res.removed));
                        syncCount();
                    })
                        .catch((error) => showMessagePopup(errorText(error), "error"));
                });
                break;
            case "report":
                void reportItem("comment", `/blog/comments/${cid}/report`);
                break;
        }
    });
    renderForm();
    await loadComments();
    if (focus)
        root.scrollIntoView({ behavior: "smooth", block: "start" });
}
/** Best-effort: tell the server to delete a just-uploaded (or now-unused) photo right away,
 * instead of letting it sit on disk until the 24h orphan sweep. Never blocks the UI. */
function discardUploadedImage(image) {
    api(`/blog/photos`, { method: "DELETE", body: JSON.stringify({ full: image.full, thumb: image.thumb }) }).catch(() => {
        /* best-effort cleanup — the orphan sweep will catch it eventually either way */
    });
}
function openComposer(editing) {
    if (!requireUser("write a story"))
        return;
    const drafts = [];
    let selectedMood = editing?.mood ?? "";
    let keyCounter = 0;
    let publishing = false;
    const isEdit = Boolean(editing && editing.id);
    if (editing?.images?.length) {
        editing.images.forEach((img) => {
            keyCounter += 1;
            drafts.push({
                key: keyCounter,
                // placeholder File (not needed for edit) — but TS requires File; make a fake stub via a 1-byte Blob
                file: new File([""], "existing"),
                blobUrl: safeUrl(img.thumb) || img.thumb,
                progress: 100,
                state: "done",
                image: { ...img },
                caption: img.caption || "",
            });
        });
    }
    const title = isEdit ? "Edit your story" : "Write a story";
    const cta = isEdit ? "Save changes" : "Publish story";
    const foot = isEdit ? "Edits go live right away." : "Your story goes live right away.";
    let published = false;
    const originalImageUrls = new Set((editing?.images ?? []).map((img) => img.full));
    const s = openSheet(`<div class="cf-sheet-head"><h2>${esc(title)}</h2><button type="button" class="cf-close" data-sheet-close aria-label="Close">&times;</button></div>
    <form class="cf-form" id="cfForm" novalidate>
      <div class="cf-field"><label for="cfTitle">Title</label>
        <input type="text" id="cfTitle" maxlength="120" placeholder="The night our jeep got stuck in a river" autocomplete="off" />
        <div class="cf-hint"><span></span><span id="cfTitleCount">0 / 120</span></div></div>
      <div class="cf-field"><label for="cfPlace">Where was this? <span class="cf-meta">(optional)</span></label>
        <input type="text" id="cfPlace" maxlength="80" placeholder="Chandratal, Himachal" autocomplete="off" /></div>
      <div class="cf-field"><span class="cf-label" id="cfMoodLabel">How does this story feel?</span>
        <div class="cf-chips" role="group" aria-labelledby="cfMoodLabel">${MOODS.map((m) => `<button type="button" class="cf-chip" data-mood="${esc(m)}" aria-pressed="${m === selectedMood}">${esc(m)}</button>`).join("")}</div></div>
      <div class="cf-field"><label for="cfBody">Your story</label>
        <textarea id="cfBody" maxlength="${BODY_MAX}" placeholder="Tell it the way you would tell it by a fire."></textarea>
        <div class="cf-hint"><span id="cfBodyHint">At least ${BODY_MIN} characters</span><span id="cfBodyCount">0 words</span></div></div>
      <div class="cf-field"><span class="cf-label">Photos <span class="cf-meta">(up to ${MAX_PHOTOS}, 8 MB each)</span></span>
        <div class="cf-thumbs" id="cfThumbs"></div>
        <input type="file" id="cfFiles" accept="image/jpeg,image/png,image/webp" multiple hidden /></div>
      <div class="cf-form-error" id="cfError" role="alert"></div>
    </form>
    <div class="cf-form-foot"><span>${esc(foot)}</span>
      <button type="button" class="cf-btn" data-sheet-close>Cancel</button>
      <button type="button" class="cf-btn cf-btn--primary" id="cfPublish" disabled>${esc(cta)}</button></div>`, {
        guard: () => {
            const dirty = titleEl.value.trim() !== (editing?.title ?? "") ||
                bodyEl.value.trim() !== (editing?.body ?? "") ||
                selectedMood !== (editing?.mood ?? "") ||
                drafts.length !== (editing?.images?.length ?? 0);
            if (publishing || !dirty)
                return true;
            return confirmDialog(isEdit ? "Your edits haven't been saved." : "Your story hasn't been published.", {
                title: isEdit ? "Discard your edits?" : "Discard this story?",
                confirmLabel: "Discard",
                danger: true,
            });
        },
        onClose: () => {
            if (published)
                return;
            // Anything uploaded during this session that never made it into a published
            // story (or wasn't already part of the story being edited) shouldn't linger.
            drafts.forEach((d) => {
                if (d.state === "done" && d.image && !originalImageUrls.has(d.image.full)) {
                    discardUploadedImage(d.image);
                }
            });
        },
    });
    const titleEl = s.sheet.querySelector("#cfTitle");
    const placeEl = s.sheet.querySelector("#cfPlace");
    const bodyEl = s.sheet.querySelector("#cfBody");
    const thumbsEl = s.sheet.querySelector("#cfThumbs");
    const filesEl = s.sheet.querySelector("#cfFiles");
    const publishEl = s.sheet.querySelector("#cfPublish");
    const errorEl = s.sheet.querySelector("#cfError");
    const bodyHint = s.sheet.querySelector("#cfBodyHint");
    if (editing) {
        titleEl.value = editing.title || "";
        placeEl.value = editing.place || "";
        bodyEl.value = editing.body ?? editing.excerpt ?? "";
    }
    titleEl.focus();
    const validate = () => {
        const bodyLen = bodyEl.value.trim().length;
        const ok = titleEl.value.trim().length >= 4 &&
            bodyLen >= BODY_MIN &&
            Boolean(selectedMood) &&
            !drafts.some((d) => d.state === "uploading") &&
            !publishing;
        publishEl.disabled = !ok;
        bodyHint.classList.toggle("is-bad", bodyLen > 0 && bodyLen < BODY_MIN);
        bodyHint.textContent = bodyLen < BODY_MIN ? `At least ${BODY_MIN} characters (${BODY_MIN - bodyLen} to go)` : "Looking good";
    };
    const renderThumbs = () => {
        const tiles = drafts
            .map((d, i) => `<div class="cf-thumb${i === 0 ? " is-cover" : ""}" data-key="${d.key}">
        <div class="cf-thumb-img"><img src="${d.blobUrl}" alt="Photo ${i + 1} preview" />
          ${i === 0 ? `<span class="cf-thumb-badge">Cover</span>` : ""}
          ${d.state === "uploading" ? `<div class="cf-thumb-progress"><i style="width:${d.progress}%"></i></div>` : ""}
          ${d.state === "error" ? `<div class="cf-thumb-progress" style="align-items:center;justify-content:center;color:#fff;font-size:13px">Failed</div>` : ""}
          <button type="button" class="cf-thumb-x" data-d="remove" aria-label="Remove photo ${i + 1}">&times;</button></div>
        ${d.state === "done" ? `<input type="text" data-d="caption" maxlength="140" placeholder="Caption (optional)" value="${esc(d.caption)}" aria-label="Caption for photo ${i + 1}" />` : ""}
        ${i > 0 && d.state === "done" ? `<button type="button" class="cf-thumb-cover-btn" data-d="cover">Make cover</button>` : ""}
      </div>`)
            .join("");
        const add = drafts.length < MAX_PHOTOS ? `<button type="button" class="cf-add-photo" id="cfAddPhoto">${ICON.photo}Add photos</button>` : "";
        thumbsEl.innerHTML = tiles + add;
        validate();
    };
    const uploadOne = (d) => {
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append("files", d.file, d.file.name);
        xhr.open("POST", `${API_BASE_URL}/blog/photos`);
        const { token } = getSession();
        if (token)
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable)
                return;
            d.progress = Math.round((event.loaded / event.total) * 100);
            const bar = thumbsEl.querySelector(`.cf-thumb[data-key="${d.key}"] .cf-thumb-progress i`);
            if (bar)
                bar.style.width = `${d.progress}%`;
        };
        xhr.onload = () => {
            try {
                const data = JSON.parse(xhr.responseText);
                if (xhr.status >= 200 && xhr.status < 300 && data.images?.[0]) {
                    d.image = data.images[0];
                    d.state = "done";
                }
                else {
                    d.state = "error";
                    errorEl.textContent = typeof data.detail === "string" ? data.detail : "Photo upload failed";
                }
            }
            catch {
                d.state = "error";
                errorEl.textContent = "Photo upload failed";
            }
            renderThumbs();
        };
        xhr.onerror = () => {
            d.state = "error";
            errorEl.textContent = "Network error while uploading the photo";
            renderThumbs();
        };
        xhr.send(form);
    };
    const addFiles = (files) => {
        errorEl.textContent = "";
        for (const file of Array.from(files ?? [])) {
            if (drafts.length >= MAX_PHOTOS) {
                errorEl.textContent = `You can add up to ${MAX_PHOTOS} photos.`;
                break;
            }
            if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
                errorEl.textContent = `${file.name}: please choose a JPG, PNG or WEBP image.`;
                continue;
            }
            if (file.size > MAX_PHOTO_BYTES) {
                errorEl.textContent = `${file.name} is larger than 8 MB.`;
                continue;
            }
            keyCounter += 1;
            const draft = { key: keyCounter, file, blobUrl: URL.createObjectURL(file), progress: 0, state: "uploading", caption: "" };
            drafts.push(draft);
            uploadOne(draft);
        }
        filesEl.value = "";
        renderThumbs();
    };
    s.sheet.addEventListener("click", (event) => {
        const t = event.target;
        const chip = t.closest("[data-mood]");
        if (chip) {
            selectedMood = chip.dataset.mood ?? "";
            s.sheet.querySelectorAll("[data-mood]").forEach((el) => el.setAttribute("aria-pressed", String(el === chip)));
            validate();
            return;
        }
        if (t.closest("#cfAddPhoto")) {
            filesEl.click();
            return;
        }
        const action = t.closest("[data-d]");
        const tile = t.closest(".cf-thumb");
        if (!action || !tile)
            return;
        const idx = drafts.findIndex((d) => d.key === Number(tile.dataset.key));
        if (idx < 0)
            return;
        if (action.dataset.d === "remove") {
            const [removed] = drafts.splice(idx, 1);
            if (removed.blobUrl.startsWith("blob:"))
                URL.revokeObjectURL(removed.blobUrl);
            if (removed.state === "done" && removed.image)
                discardUploadedImage(removed.image);
            renderThumbs();
        }
        else if (action.dataset.d === "cover") {
            drafts.unshift(...drafts.splice(idx, 1));
            renderThumbs();
        }
    });
    s.sheet.addEventListener("input", (event) => {
        const t = event.target;
        if (t.dataset.d === "caption") {
            const key = Number(t.closest(".cf-thumb").dataset.key);
            const d = drafts.find((x) => x.key === key);
            if (d)
                d.caption = t.value;
        }
    });
    filesEl.addEventListener("change", () => addFiles(filesEl.files));
    titleEl.addEventListener("input", () => {
        s.sheet.querySelector("#cfTitleCount").textContent = `${titleEl.value.length} / 120`;
        validate();
    });
    bodyEl.addEventListener("input", () => {
        const words = bodyEl.value.trim() ? bodyEl.value.trim().split(/\s+/).length : 0;
        s.sheet.querySelector("#cfBodyCount").textContent = `${words} word${words === 1 ? "" : "s"}`;
        validate();
    });
    s.sheet.querySelector("#cfForm").addEventListener("submit", (e) => e.preventDefault());
    publishEl.addEventListener("click", () => {
        publishing = true;
        publishEl.disabled = true;
        publishEl.textContent = isEdit ? "Saving…" : "Publishing…";
        errorEl.textContent = "";
        const images = drafts.filter((d) => d.state === "done" && d.image).map((d) => ({ ...d.image, caption: d.caption.trim() }));
        const payload = JSON.stringify({ title: titleEl.value, body: bodyEl.value, mood: selectedMood, place: placeEl.value, images });
        const req = isEdit
            ? api(`/blog/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: payload })
            : api("/blog", { method: "POST", body: payload });
        req
            .then(({ post }) => {
            drafts.forEach((d) => {
                if (d.blobUrl.startsWith("blob:"))
                    URL.revokeObjectURL(d.blobUrl);
            });
            published = true;
            s.close();
            const full = { ...post, excerpt: (post.body ?? "").slice(0, 220), truncated: (post.body ?? "").length > 220 };
            cache.set(full.id, full);
            if (isEdit) {
                const el = postsEl.querySelector(`.cf-post[data-id="${CSS.escape(full.id)}"]`);
                if (el)
                    el.outerHTML = postHtml(full);
                showMessagePopup("Changes saved");
            }
            else {
                const fits = view === "home" && (mood === "All" || mood === post.mood);
                if (fits) {
                    postsEl.querySelector(".cf-empty")?.remove();
                    statusEl.innerHTML = "";
                    postsEl.insertAdjacentHTML("afterbegin", postHtml(full));
                }
                showMessagePopup("Your story is live");
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        })
            .catch((error) => {
            publishing = false;
            publishEl.textContent = isEdit ? "Save changes" : "Publish story";
            errorEl.textContent = errorText(error);
            validate();
        });
    });
    renderThumbs();
    // Sync hint + counters once with pre-filled values (edit mode).
    titleEl.dispatchEvent(new Event("input"));
    bodyEl.dispatchEvent(new Event("input"));
    validate();
}
/* ---------- navigation, filters, boot ---------- */
function renderMoods() {
    moodsEl.innerHTML = ["All", ...MOODS]
        .map((m) => `<button type="button" class="cf-mood${m === mood ? " is-on" : ""}" role="tab" aria-selected="${m === mood}" data-mood="${esc(m)}">${esc(m)}</button>`)
        .join("");
}
function applyView() {
    document.querySelectorAll("#cfNav [data-view]").forEach((btn) => {
        const on = btn.dataset.view === view;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", String(on));
    });
    const title = view === "explore" ? "Most loved stories" : view === "saved" ? "Saved stories" : "";
    viewTitleEl.hidden = !title;
    viewTitleEl.textContent = title;
    renderMoods();
}
function setView(next) {
    if (next === "saved" && !requireUser("see your saved stories"))
        return;
    view = next;
    if (next === "home")
        mood = "All";
    applyView();
    window.scrollTo({ top: 0 });
    void loadMore(true);
}
moodsEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-mood]");
    if (!btn)
        return;
    mood = btn.dataset.mood ?? "All";
    applyView();
    void loadMore(true);
});
$("cfNav").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-view]");
    if (btn)
        setView(btn.dataset.view);
});
$("cfCompose").addEventListener("click", () => openComposer());
new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting))
        void loadMore();
}, { rootMargin: "700px 0px" }).observe(sentinelEl);
const { user } = getSession();
if (user?.role === "user" && user.name)
    $("cfComposeAvatar").textContent = user.name.charAt(0).toUpperCase();
const deepParams = new URLSearchParams(window.location.search);
const wantedView = deepParams.get("view");
if (wantedView === "home" || wantedView === "explore" || wantedView === "saved") {
    view = wantedView === "saved" && !isUser() ? "explore" : wantedView;
}
applyView();
void loadMore(true);
const deepLink = deepParams.get("story");
const wantsEdit = deepParams.get("edit") === "1";
if (deepLink) {
    if (wantsEdit)
        void editPost(deepLink);
    else
        void openReader(deepLink);
}
