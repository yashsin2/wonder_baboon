import { API_BASE_URL, Booking, clearSession, getSession, isUpcomingTravelDate } from "./config.js";

const { token, user } = getSession();

if (!token || !user || user.role !== "user") {
  window.location.href = "./auth.html";
}

const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};

(document.getElementById("logoutBtn") as HTMLButtonElement).addEventListener("click", () => {
  clearSession();
  window.location.href = "./index.html";
});

function setAvatarInitials(name: string): void {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
  (document.getElementById("profileAvatarInit") as HTMLElement).textContent = initials || "WB";
}

async function loadUserProfile(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/user/profile`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to load profile");

    (document.getElementById("profileName") as HTMLElement).textContent = data.name;
    (document.getElementById("profileEmail") as HTMLElement).textContent = data.email;
    (document.getElementById("profileMobile") as HTMLElement).textContent = data.mobile;
    setAvatarInitials(data.name || "WB");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile";
    (document.getElementById("profileName") as HTMLElement).textContent = message;
  }
}

async function loadUserBookings(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/user/bookings`, { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to load bookings");

    const bookings = (data.bookings || []) as Booking[];
    const upcoming = bookings.filter((b) => isUpcomingTravelDate(b.dateOfTravel));
    const completed = bookings.filter((b) => !isUpcomingTravelDate(b.dateOfTravel));

    function escape(raw: string): string {
      return raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function upcomingPaymentLine(booking: Booking): string {
      const paid = booking.payment === "paid";
      const cls = paid ? "booking-payment booking-payment--confirmed" : "booking-payment booking-payment--pending";
      const text = paid
        ? "Booking confirmed."
        : "Your booking will be confirmed after advance payment.";
      return `<p class="${cls}">${text}</p>`;
    }

    function createBookingCard(booking: Booking, opts?: { paymentNote?: boolean }): string {
      const dest = escape(String(booking.travelDestination ?? ""));
      const payment = opts?.paymentNote ? upcomingPaymentLine(booking) : "";
      return `
        <div class="booking-card">
          <div class="booking-header">
            <h4>${dest}</h4>
            <span class="badge ${booking.tripType === "defined_trip" ? "defined" : "planned"}">
              ${booking.tripType === "defined_trip" ? "Defined Trip" : "Planned Trip"}
            </span>
          </div>
          <div class="booking-details">
            <p><strong>Travel date:</strong> ${new Date(booking.dateOfTravel).toLocaleDateString()}</p>
            <p><strong>People:</strong> ${booking.numberOfPeople}</p>
            <p><strong>Booked on:</strong> ${new Date(booking.createdAt).toLocaleDateString()}</p>
          </div>
          ${payment}
        </div>
      `;
    }

    (document.getElementById("upcomingTrips") as HTMLElement).innerHTML =
      upcoming.length > 0
        ? upcoming.map((b) => createBookingCard(b, { paymentNote: true })).join("")
        : "<p style='text-align:center;'>No upcoming bookings yet. Book a trip from the home page.</p>";

    (document.getElementById("completedTrips") as HTMLElement).innerHTML =
      completed.length > 0
        ? completed.map((b) => createBookingCard(b)).join("")
        : "<p style='text-align:center;'>No completed travels yet.</p>";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load bookings";
    (document.getElementById("upcomingTrips") as HTMLElement).innerHTML =
      `<p style='text-align:center;color:#ffb3b3;'>${message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadUserProfile();
  loadUserBookings();
});
