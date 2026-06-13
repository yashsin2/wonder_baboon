import { getCompletedAdventures, loadTravelGalleryFromApi, PREVIOUS_ADVENTURES } from "./previous-adventures-data.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Renders the home page “Previous Travels” preview from adventure data */
export async function mountHomePreviousTravels(): Promise<void> {
  await loadTravelGalleryFromApi();
  const root = document.getElementById("homePreviousTravels");
  if (!root) return;

  const completed = getCompletedAdventures();
  const comingSoon = PREVIOUS_ADVENTURES.filter((a) => a.status === "coming_soon").slice(0, 3);

  const cards = [
    ...completed.map((adv) => {
      const meta = [
        adv.dates,
        adv.travelers ? `${adv.travelers} travelers` : "",
        adv.days ? `${adv.days} days` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return `
        <a class="home-adv-card home-adv-card--live" href="/previous-adventures?dest=${escapeHtml(adv.id)}">
          <img src="${escapeHtml(adv.heroImage)}" alt="${escapeHtml(adv.title)}" loading="lazy" decoding="async" />
          <div class="home-adv-card-body">
            <span class="home-adv-badge home-adv-badge--done">Completed</span>
            <h3>${escapeHtml(adv.title)}</h3>
            ${meta ? `<p class="home-adv-meta">${escapeHtml(meta)}</p>` : ""}
            <span class="home-adv-link">View photos &amp; stories →</span>
          </div>
        </a>`;
    }),
    ...comingSoon.map(
      (adv) => `
        <a class="home-adv-card home-adv-card--soon" href="/previous-adventures?dest=${escapeHtml(adv.id)}">
          <img src="${escapeHtml(adv.heroImage)}" alt="" loading="lazy" decoding="async" />
          <div class="home-adv-card-body">
            <span class="home-adv-badge home-adv-badge--soon">Coming soon</span>
            <h3>${escapeHtml(adv.title)}</h3>
            <p class="home-adv-meta">Stories on the way</p>
          </div>
        </a>`
    ),
  ].join("");

  root.innerHTML = cards;
}
