# Deploying to Hostinger (wonderbaboon.com)

The site uses **clean URLs** (`/upcoming-trips`, not `/upcoming-trips.html`). Hostinger does not do this automatically — you must upload `.htaccess`.

## Upload checklist

1. From `frontend/`, run **`npm run deploy:prepare`** (builds TypeScript + stamps cache-bust version on HTML/JS).
2. Upload the whole `frontend/` folder contents into `public_html` (or your web root).
3. Confirm **`public_html/.htaccess`** is present (enable “show hidden files” in File Manager).
4. Confirm **`public_html/version.json`** was uploaded (drives the “site updated — refresh” banner for open tabs).
5. On the **API server** (VPS), set CORS to both hosts (or rely on `.htaccess` www → apex redirect):

   ```env
   CORS_ORIGINS=https://wonderbaboon.com,https://www.wonderbaboon.com
   ENV=production
   RAZORPAY_KEY_ID=rzp_live_...
   RAZORPAY_KEY_SECRET=...
   ```

   Then restart the API. Without this, visitors on `www.wonderbaboon.com` cannot call `api.wonderbaboon.com` and Razorpay never opens.

Returning visitors pick up changes automatically; users with an old tab open see a refresh prompt at the bottom of the page.

## Required file: `.htaccess`

This file lives at `frontend/.htaccess` in the repo. It must sit next to `index.html` on the server.

If clean URLs still 404:

- In hPanel → **Advanced** → **Directory Index** — ensure `.htaccess` is allowed.
- Or add **Redirects** in hPanel for each path:
  - `/upcoming-trips` → `/upcoming-trips.html` (internal rewrite if offered)
  - `/previous-trips` → `/previous-trips.html`
  - `/settings` → `/settings.html`
  - `/auth` → `/auth.html`
  - `/user-dashboard` → `/user-dashboard.html` (legacy; redirects to `/upcoming-trips`)

## Quick test

| URL | Expected |
|-----|----------|
| `https://wonderbaboon.com/` | Home |
| `https://wonderbaboon.com/upcoming-trips` | Your trips page |
| `https://wonderbaboon.com/backpackers` | The Backpackers collection |
| `https://wonderbaboon.com/motorcycle-diaries` | The Motorcycle Diaries |
| `https://wonderbaboon.com/dolce-far-niente` | Dolce far niente |
| `https://wonderbaboon.com/hikers` | The Hikers |
| `https://wonderbaboon.com/upcoming-trips.html` | Redirects to `/upcoming-trips` |
