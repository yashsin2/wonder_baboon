#!/usr/bin/env python3
"""Write each page's SEO <head> block from scripts/seo_pages.json.

Idempotent: everything between <!-- SEO:START --> and <!-- SEO:END --> is regenerated, and the page's old
<title> / <meta name="description"> are replaced. Public pages get a canonical URL, Open Graph / Twitter tags and
JSON-LD; private pages (login, settings, your trips, admin) get `noindex`.

Usage:  python3 scripts/apply_seo.py
"""
import json
import re
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / "frontend"
CFG = json.loads((Path(__file__).parent / "seo_pages.json").read_text(encoding="utf-8"))
SITE = CFG["site"]
START, END = "<!-- SEO:START -->", "<!-- SEO:END -->"


def abs_url(path):
  return SITE["origin"] + path


def ld(obj):
  return '<script type="application/ld+json">\n' + json.dumps(obj, indent=2, ensure_ascii=False) + "\n</script>"


def organization():
  return {
    "@type": "TravelAgency",
    "@id": SITE["origin"] + "/#organization",
    "name": SITE["name"],
    "legalName": SITE["legalName"],
    "url": SITE["origin"] + "/",
    "logo": {"@type": "ImageObject", "url": abs_url(SITE["logo"]), "width": 192, "height": 192},
    "image": abs_url(SITE["ogImage"]),
    "email": SITE["email"],
    "telephone": SITE["telephone"],
    "address": {
      "@type": "PostalAddress",
      "addressLocality": SITE["address"]["locality"],
      "addressRegion": SITE["address"]["region"],
      "addressCountry": SITE["address"]["country"],
    },
    "areaServed": {"@type": "Country", "name": "India"},
    "contactPoint": [{"@type": "ContactPoint", "contactType": "customer service", "telephone": SITE["telephone"], "email": SITE["email"]}],
    "sameAs": SITE["sameAs"],
  }


def website():
  return {
    "@type": "WebSite",
    "@id": SITE["origin"] + "/#website",
    "url": SITE["origin"] + "/",
    "name": SITE["name"],
    "inLanguage": "en-IN",
    "publisher": {"@id": SITE["origin"] + "/#organization"},
  }


def json_ld_for(page):
  url = abs_url(page["path"])
  graph = []
  if page["kind"] == "home":
    graph += [organization(), website()]
    graph.append({
      "@type": "WebPage", "@id": url + "#webpage", "url": url, "name": page["title"], "description": page["description"],
      "isPartOf": {"@id": SITE["origin"] + "/#website"}, "about": {"@id": SITE["origin"] + "/#organization"}, "inLanguage": "en-IN",
    })
  else:
    graph.append({
      "@type": "CollectionPage", "@id": url + "#webpage", "url": url, "name": page["title"], "description": page["description"],
      "isPartOf": {"@id": SITE["origin"] + "/#website"}, "publisher": {"@id": SITE["origin"] + "/#organization"}, "inLanguage": "en-IN",
    })
    graph.append({
      "@type": "BreadcrumbList",
      "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE["origin"] + "/"},
        {"@type": "ListItem", "position": 2, "name": page["crumb"], "item": url},
      ],
    })
    graph.append(website())
    graph.append(organization())
  return ld({"@context": "https://schema.org", "@graph": graph})


def block(name, page):
  title, desc = escape(page["title"], quote=True), escape(page["description"], quote=True)
  lines = [START, f"<title>{title}</title>", f'<meta name="description" content="{desc}">']
  if page.get("private"):
    robots = "noindex, nofollow" if page.get("nofollow") else "noindex, follow"
    lines.append(f'<meta name="robots" content="{robots}">')
    lines.append('<meta name="theme-color" content="#ffffff">')
  else:
    url = abs_url(page["path"])
    img = abs_url(SITE["ogImage"])
    lines += [
      '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">',
      f'<link rel="canonical" href="{url}">',
      '<meta name="theme-color" content="#ffffff">',
      '<meta name="application-name" content="Wonder Baboon">',
      '<meta property="og:type" content="website">',
      f'<meta property="og:site_name" content="{SITE["name"]}">',
      '<meta property="og:locale" content="en_IN">',
      f'<meta property="og:url" content="{url}">',
      f'<meta property="og:title" content="{title}">',
      f'<meta property="og:description" content="{desc}">',
      f'<meta property="og:image" content="{img}">',
      f'<meta property="og:image:alt" content="{escape(SITE["ogImageAlt"], quote=True)}">',
      '<meta name="twitter:card" content="summary_large_image">',
      f'<meta name="twitter:title" content="{title}">',
      f'<meta name="twitter:description" content="{desc}">',
      f'<meta name="twitter:image" content="{img}">',
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      json_ld_for(page),
    ]
  lines.append(END)
  return "\n  ".join(lines)


def apply(name, page):
  path = FRONT / f"{name}.html"
  if not path.exists():
    print("skip (missing):", name)
    return
  html = path.read_text(encoding="utf-8")
  html = re.sub(r"\s*" + re.escape(START) + r".*?" + re.escape(END), "", html, flags=re.S)
  html = re.sub(r"\s*<title>.*?</title>", "", html, count=1, flags=re.S)
  html = re.sub(r'\s*<meta name="description"[^>]*>', "", html, count=1)
  html = re.sub(r'\s*<meta name="robots"[^>]*>', "", html)
  # existing single-organization JSON-LD on the home page is replaced by the richer graph
  if not page.get("private") and page.get("kind") == "home":
    html = re.sub(r'\s*<script type="application/ld\+json">\s*\{\s*"@context": "https://schema.org",\s*"@type": "Organization".*?</script>', "", html, flags=re.S)
  html = html.replace('<html lang="en">', '<html lang="en-IN">', 1)
  html, n = re.subn(r"</head>", "  " + block(name, page) + "\n</head>", html, count=1)
  if n != 1:
    raise SystemExit(f"no </head> in {name}.html")
  path.write_text(html, encoding="utf-8")
  print("ok  ", name)


for page_name, page_cfg in CFG["pages"].items():
  apply(page_name, page_cfg)
