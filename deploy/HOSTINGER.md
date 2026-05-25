# Deploying to Hostinger (wonderbaboon.com)

The site uses **clean URLs** (`/upcoming-trips`, not `/upcoming-trips.html`). Hostinger does not do this automatically — you must upload `.htaccess`.

## Upload checklist

1. Upload the whole `frontend/` folder contents into `public_html` (or your web root).
2. Confirm **`public_html/.htaccess`** is present (enable “show hidden files” in File Manager).
3. Hard-refresh the browser after deploy.

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
| `https://wonderbaboon.com/upcoming-trips.html` | Redirects to `/upcoming-trips` |
