/**
 * Built-in itineraries for trips (extend per destination). Content from ops PDFs — safe static HTML only.
 */
function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

type ItineraryId = "jibhi" | "chandratal";

function resolveItineraryId(title: string, location = ""): ItineraryId | null {
  const t = normalizeKey(title);
  const l = normalizeKey(location);
  if (t.includes("jibhi") || l.includes("jibhi") || t.includes("sojha")) {
    return "jibhi";
  }
  if (t.includes("chandratal") || l.includes("chandratal")) {
    return "chandratal";
  }
  if (t.includes("spiti")) {
    return "chandratal";
  }
  return null;
}

/** Returns true if this catalog trip has an itinerary we can show */
export function tripHasItinerary(title: string, location = ""): boolean {
  return resolveItineraryId(title, location) !== null;
}

const JIBHI_HTML = `
<section class="itinerary-block">
  <h4>🌿 Jibhi backpacking trip</h4>
  <p class="itinerary-meta">4 days / 3 nights · Chandigarh to Chandigarh · ₹7,999 per person (indicative)</p>

  <h4>Day 1: Chandigarh → Jibhi</h4>
  <ul>
    <li>Early morning departure (05:00 – 06:00)</li>
    <li>Scenic drive via Bilaspur &amp; Mandi</li>
    <li>Reach Jibhi by afternoon (02:00 – 03:00)</li>
    <li>Check-in to mountain-view homestay</li>
    <li>Evening: relax, bonfire, introductions &amp; music</li>
  </ul>

  <h4>Day 2: Jalori Pass + Raghupur Fort trek</h4>
  <ul>
    <li>Early breakfast</li>
    <li>Drive to Jalori Pass · trek to Raghupur Fort (~3 km, easy–moderate)</li>
    <li>Open meadows &amp; Himalayan views</li>
    <li>Evening: return to stay, bonfire</li>
  </ul>

  <h4>Day 3: Serolsar Lake trek</h4>
  <ul>
    <li>Early breakfast</li>
    <li>Drive to Jalori Pass · trek to Serolsar Lake (~5 km one way, easy–moderate)</li>
    <li>Forest trail &amp; alpine lake — core highlight</li>
    <li>Evening: bonfire &amp; open mic</li>
  </ul>

  <h4>Day 4: Jibhi sightseeing → Chandigarh</h4>
  <ul>
    <li>Breakfast &amp; checkout</li>
    <li>Stops: Jibhi Waterfall, Mini Thailand Jibhi</li>
    <li>Depart for Chandigarh · arrive evening (05:00 – 07:00)</li>
  </ul>

  <h4>Inclusions</h4>
  <ul>
    <li>Chandigarh–Chandigarh transport</li>
    <li>3 nights homestay</li>
    <li>3 breakfasts &amp; 3 dinners · bonfire · trek assistance</li>
  </ul>

  <h4>Exclusions</h4>
  <ul>
    <li>Lunch &amp; café · personal expenses</li>
  </ul>

  <h4>Good to know</h4>
  <ul>
    <li>Limited network — carry cash</li>
    <li>Trekking shoes recommended · evenings can be cold</li>
  </ul>
</section>`.trim();

/** From “Chandratal &amp; Spiti Adventure — 5 Days / 4 Nights” PDF */
const CHANDRATAL_HTML = `
<section class="itinerary-block">
  <h4>🏔️ Chandratal &amp; Spiti Adventure</h4>
  <p class="itinerary-meta">5 days / 4 nights · Pickup: Delhi / Chandigarh · Double-sharing camps &amp; comfortable stays</p>
  <p class="itinerary-meta">Travel style: comfortable road trip with adventure vibes · Best for backpackers, photographers, mountain lovers &amp; stargazers</p>

  <h4>Package options (indicative)</h4>
  <ul>
    <li><strong>Traveller package — ₹17,000 pp:</strong> Tempo Traveller · double sharing · meals included · great for groups</li>
    <li><strong>4×4 adventure — ₹22,000 pp:</strong> SUV · smoother on Spiti terrain · double sharing · premium road-trip feel</li>
  </ul>

  <h4>Day 1 — Delhi / Chandigarh to Naggar</h4>
  <ul>
    <li>Overnight Volvo or road journey from Delhi or Chandigarh</li>
    <li>Reach Naggar in the morning · check-in with mountain &amp; valley views</li>
    <li>Explore Naggar cafés, castle &amp; riverside</li>
    <li>Bonfire &amp; music · <strong>stay:</strong> cozy mountain stay · <strong>meals:</strong> dinner</li>
  </ul>

  <h4>Day 2 — Naggar to Kaza via Atal Tunnel &amp; Kunzum Pass</h4>
  <ul>
    <li>Early start towards Spiti · Lahaul landscapes</li>
    <li>Drive through Kunzum Pass adventure · reach Kaza by evening</li>
    <li>Café hopping &amp; local market · <strong>stay:</strong> hotel/homestay Kaza · <strong>meals:</strong> breakfast &amp; dinner</li>
  </ul>

  <h4>Day 3 — Key Monastery, Hikkim, Komic &amp; Langza</h4>
  <ul>
    <li>Key Monastery · Hikkim (world’s highest post office) · Komic village</li>
    <li>Langza: fossil hunting &amp; giant Buddha</li>
    <li>Night sky / stargazing (Spiti dark-sky highlight)</li>
    <li><strong>Stay:</strong> Kaza · <strong>meals:</strong> breakfast &amp; dinner</li>
  </ul>

  <h4>Day 4 — Kaza to Chandratal Lake camp</h4>
  <ul>
    <li>Scenic drive to Chandratal · moon lake camps by evening</li>
    <li>Bonfire, music &amp; astrophotography · <strong>stay:</strong> double-sharing Swiss camps near Chandratal</li>
    <li><strong>Meals:</strong> breakfast &amp; dinner</li>
  </ul>

  <h4>Day 5 — Chandratal to Delhi / Chandigarh</h4>
  <ul>
    <li>Early lake visit · return journey</li>
    <li>Drop Chandigarh / Delhi · <strong>meals:</strong> breakfast</li>
  </ul>

  <h4>Trip highlights</h4>
  <ul>
    <li>Chandratal camping · Key Monastery · highest post office · Himalayan cafés · stargazing</li>
    <li>Comfortable yet adventurous driving · local food throughout</li>
  </ul>

  <h4>Inclusions</h4>
  <ul>
    <li>Travel from Delhi / Chandigarh · accommodation (double sharing)</li>
    <li>Breakfast &amp; dinner · local sightseeing</li>
    <li>Driver allowance, tolls &amp; parking · trip coordinator</li>
  </ul>

  <h4>Exclusions</h4>
  <ul>
    <li>Personal expenses · entry tickets if applicable · lunch/snacks · any emergency costs</li>
  </ul>

  <h4>Perfect for</h4>
  <p class="itinerary-meta">Backpackers · creators · couples · solo travelers · adventure &amp; astrophotography lovers</p>
</section>`.trim();

/**
 * Inner HTML for itinerary modal (trusted static markup).
 * Pass catalog <code>location</code> when the trip <code>title</code> does not include the place name (e.g. Sojha → Jibhi).
 */
export function getItineraryHtml(title: string, location = ""): string | null {
  const id = resolveItineraryId(title, location);
  if (id === "jibhi") return JIBHI_HTML;
  if (id === "chandratal") return CHANDRATAL_HTML;
  return null;
}

/** Trip row from API — may include admin-uploaded HTML from a PDF */
export type TripItinerarySource = {
  title: string;
  location?: string;
  itineraryHtml?: string | null;
};

export function tripHasItineraryForTrip(trip: TripItinerarySource): boolean {
  if ((trip.itineraryHtml || "").trim().length > 0) return true;
  return tripHasItinerary(trip.title, trip.location || "");
}

export function getItineraryHtmlForTrip(trip: TripItinerarySource): string | null {
  const custom = (trip.itineraryHtml || "").trim();
  if (custom.length > 0) return custom;
  return getItineraryHtml(trip.title, trip.location || "");
}
