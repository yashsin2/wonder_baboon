# Wonder Baboon System Architecture

## 🏗️ System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         WONDER BABOON SYSTEM                        │
└─────────────────────────────────────────────────────────────────────┘

                          FRONTEND (Browser)
                    ┌───────────────────────────┐
                    │   Vanilla JavaScript       │
                    │   HTML5 / CSS3             │
                    │   No Framework Overhead    │
                    └───────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
    ┌────────┐          ┌──────────┐       ┌──────────┐
    │ Home   │          │Auth Page │       │Dashboards│
    │(index) │          │(auth)    │       │(user,    │
    └────────┘          └──────────┘       │ admin)   │
        │                    │               └──────────┘
        │ Browse Trips       │ Login/Signup      │ Manage
        │ Search             │ Role Select       │ View History
        │ Book               │                   │ Analytics
        │ Plan Trip          │                   │
        └────────────────────┼───────────────────┘
                             │
                    HTTP/REST API Calls
                             │
        ┌────────────────────▼────────────────────┐
        │                                         │
    ╔═══════════════════════════════════════════╗
    ║   FASTAPI BACKEND (Python 3.9+)          ║
    ║   Running on http://localhost:5051       ║
    ╚═══════════════════════════════════════════╝
        │
        ├─ app/main.py (500+ lines)
        │   ├── Authentication Routes
        │   │   ├── POST /api/auth/signup
        │   │   └── POST /api/auth/login
        │   │
        │   ├── Trip Routes
        │   │   ├── GET /api/trips
        │   │   ├── GET /api/admin/trips
        │   │   └── POST /api/admin/trips
        │   │
        │   ├── Booking Routes
        │   │   ├── POST /api/bookings/guest
        │   │   ├── POST /api/bookings/user
        │   │   ├── POST /api/planned-trips
        │   │   └── GET /api/admin/bookings
        │   │
        │   ├── User Routes
        │   │   ├── GET /api/user/profile
        │   │   └── GET /api/user/bookings
        │   │
        │   └── Admin Routes
        │       └── GET /api/admin/stats
        │
        │
        ├─ Security Features
        │   ├── PBKDF2-HMAC-SHA256 (password hashing)
        │   ├── JWT tokens (12-hour expiration)
        │   ├── Input validation & sanitization
        │   ├── CORS enabled
        │   └── XSS prevention
        │
        └─ Database Layer
                    │
            ┌───────▼───────┐
            │  MongoDB       │
            │  (userlogin    │
            │   details DB)  │
            └───────────────┘
                │
        ┌───────┴───────┬────────────┬──────────────┐
        │               │            │              │
    ┌────────┐  ┌──────────┐  ┌─────────┐  ┌──────────────┐
    │user_   │  │admin_    │  │add_trip │  │user_trip_    │
    │login   │  │login     │  │detail   │  │details       │
    └────────┘  └──────────┘  └─────────┘  └──────────────┘
    │           │              │             │
    ├─ name     ├─ username    ├─ title     ├─ tripType
    ├─ email    ├─ password    ├─ location  ├─ destination
    ├─ mobile   └─ (indexed)   ├─ duration  ├─ dateOfTravel
    ├─ password                ├─ price     ├─ fullName
    └─ (indexed)               ├─ dates     ├─ mobile
                               ├─ image     ├─ email
                               └─ (indexed) ├─ people
                                            └─ (indexed)
```

---

## 🔄 User Journey Flows

### Flow 1: Guest Booking
```
Home Page
   │
   ├─ User clicks "Book" on trip card
   │
   ├─ NO authentication check (guest)
   │
   ├─ Trip Details Popup
   │   └─ Shows: title, location, duration, price, dates
   │
   ├─ "Book This Trip" button
   │
   ├─ Form Modal
   │   ├─ Name (required)
   │   ├─ Mobile (required, validated)
   │   ├─ Email (optional)
   │   ├─ Date (pre-filled with trip start date)
   │   └─ People (1-20)
   │
   ├─ POST /api/bookings/guest
   │   └─ Data sent to backend
   │
   ├─ MongoDB: Insert into user_trip_details
   │   └─ source: "guest_booking"
   │
   └─ Confirmation Popup
       ├─ Message: "Booking done. Our team will contact you soon"
       └─ Auto-close after 3-4 seconds
```

### Flow 2: User Registration & Booking
```
Auth Page
   │
   ├─ "Create User Account" section
   │   ├─ Name
   │   ├─ Email (unique)
   │   ├─ Mobile (validated)
   │   └─ Password (uppercase, lowercase, digit, min 8)
   │
   ├─ POST /api/auth/signup
   │
   ├─ MongoDB: Insert into user_login
   │
   ├─ JWT token created
   │
   ├─ Auto-redirect to /user-dashboard.html
   │
   └─ User Dashboard
       ├─ Profile shown on left sidebar
       ├─ Upcoming trips section
       └─ Completed travels section
```

### Flow 3: User Login & Booking
```
Auth Page
   │
   ├─ Select: "User/Backpacker" (dropdown)
   │
   ├─ Enter Email & Password
   │
   ├─ POST /api/auth/login
   │   └─ Backend validates credentials
   │
   ├─ JWT token created & stored
   │
   ├─ Auto-redirect to /user-dashboard.html
   │
   ├─ User clicks "Book" on trip
   │
   ├─ Backend validates JWT token
   │
   ├─ Fetch user profile from MongoDB
   │
   ├─ POST /api/bookings/user
   │   └─ Auto-populated with user profile
   │
   ├─ NO FORM SHOWN - direct booking
   │
   ├─ MongoDB: Insert into user_trip_details
   │   └─ source: "logged_in_direct_booking"
   │
   └─ Confirmation Popup
```

### Flow 4: Admin Login & Management
```
Auth Page
   │
   ├─ Select: "Admin" (dropdown)
   │
   ├─ Enter Admin Username & Password
   │
   ├─ POST /api/auth/login
   │   └─ Role validation: admin
   │
   ├─ JWT token with role: "admin"
   │
   ├─ Auto-redirect to /admin-dashboard.html
   │
   ├─ Dashboard & Stats Tab
   │   ├─ GET /api/admin/stats
   │   └─ Display 6 stat cards
   │
   ├─ Bookings Tab
   │   ├─ GET /api/admin/bookings
   │   └─ Can search by destination/name/mobile
   │
   └─ Add Trip Tab
       ├─ Form with trip details
       ├─ POST /api/admin/trips
       └─ Data inserted into add_trip_detail
```

### Flow 5: Plan Custom Trip
```
Home Page - "Plan Trip" Section
   │
   ├─ Enter: Destination
   │
   ├─ Enter: Date of Travel
   │
   ├─ Click: "Plan Trip"
   │
   ├─ Form Modal
   │   ├─ Name (required)
   │   ├─ Mobile (required, validated)
   │   ├─ Email (optional)
   │   └─ People (1-20)
   │
   ├─ POST /api/planned-trips
   │
   ├─ MongoDB: Insert into user_trip_details
   │   └─ source: "planned_trip_form"
   │   └─ tripType: "planned_trip"
   │
   └─ Confirmation Popup
       └─ "Planned trip saved. Our team will contact you soon."
```

---

## 📱 API Request/Response Examples

### Authentication
```json
// POST /api/auth/signup
Request:
{
  "name": "John Doe",
  "email": "john@example.com",
  "mobile": "9876543210",
  "password": "TestPass123"
}

Response:
{
  "token": "eyJhbGc...",
  "user": {
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user"
  }
}
```

### Booking
```json
// POST /api/bookings/guest
Request:
{
  "trip_id": "507f1f77bcf86cd799439011",
  "travel_destination": "Spiti Circuit",
  "date_of_travel": "2026-06-15",
  "full_name": "John Doe",
  "mobile": "9876543210",
  "email": "john@example.com",
  "number_of_people": 2
}

Response:
{
  "message": "booking saved"
}
```

### Get Trips
```json
// GET /api/trips
Response:
{
  "trips": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "title": "Spiti Circuit + Chandratal",
      "location": "Himachal Pradesh",
      "durationLabel": "7D/6N",
      "price": 15999,
      "startDate": "2026-06-12",
      "endDate": "2026-06-18",
      "imageUrl": "./assets/lake.jpg"
    }
  ]
}
```

### Admin Stats
```json
// GET /api/admin/stats (requires JWT with role: "admin")
Response:
{
  "totalTrips": 10,
  "totalBookings": 45,
  "definedTripBookings": 30,
  "plannedTripBookings": 15,
  "monthBookings": 12,
  "currentMonth": "May 2026"
}
```

---

## 🔐 Authentication Flow

```
┌─────────────────────────────────────────────┐
│         Authentication Process              │
└─────────────────────────────────────────────┘

1. User Enters Credentials
   │
   ├─ Frontend validates locally
   │
   ├─ POST to /api/auth/login or /api/auth/signup
   │
2. Backend Processing
   │
   ├─ Validate input format
   │
   ├─ Check MongoDB (user_login or admin_login)
   │
   ├─ Hash password & compare
   │   └─ PBKDF2-HMAC-SHA256 with 200,000 iterations
   │
3. Token Generation
   │
   ├─ Create JWT payload
   │   ├─ role: "user" | "admin"
   │   ├─ email: (for users) | username: (for admins)
   │   └─ exp: +12 hours
   │
   ├─ Sign with JWT_SECRET
   │
4. Frontend Storage
   │
   ├─ localStorage.setItem("wb_token", token)
   │
   ├─ localStorage.setItem("wb_user", JSON.stringify(user))
   │
5. Subsequent Requests
   │
   ├─ Add header: Authorization: Bearer <token>
   │
   ├─ Backend verifies JWT signature
   │
   ├─ Extract role & permissions
   │
   └─ Execute request if authorized
```

---

## 🗂️ File Dependencies

```
Frontend Files:
│
├─ index.html
│  └── script.js
│      └── Creates booking popups, handles trips
│
├─ auth.html
│  └── auth.js
│      └── Signup, login, role selection
│
├─ user-dashboard.html
│  └── user-dashboard.js
│      └── Profile, booking history
│
└─ admin-dashboard.html
   └── admin-dashboard.js
       └── Stats, manage trips, search bookings

Backend Files:
│
└─ app/main.py
   ├── Authentication (signup, login)
   ├── Trips (list, add, search)
   ├── Bookings (guest, user, planned)
   ├── User management
   └── Admin analytics

Database:
│
└─ MongoDB (userlogindetails DB)
   ├── user_login
   ├── admin_login
   ├── add_trip_detail
   └── user_trip_details
```

---

## ⚙️ Configuration & Environment

```
┌─────────────────────────────────────┐
│     .env Configuration              │
└─────────────────────────────────────┘

MONGO_URI
├─ Local: mongodb://localhost:27017/userlogindetails
└─ Atlas: mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true

JWT_SECRET
├─ Secret key for token signing
└─ Should be 32+ characters, random

ADMIN_USERNAME
├─ Default: wb_admin
└─ Used for admin login

ADMIN_PASSWORD
├─ Default: WB_Admin@2026
└─ Change in production!

Server Port: 5051
Server Host: 127.0.0.1 (localhost)
```

---

## 🔄 Data Flow Examples

### Example 1: Guest Books Trip
```
Client Browser                 FastAPI Server              MongoDB
     │                              │                        │
     ├─ Click "Book" ──────────────>│                        │
     │                              │ Fetch trip details     │
     │<────── Trip Modal ───────────│                        │
     │                              │                        │
     ├─ Fill form ───────────────>│                        │
     │                             │ POST /api/bookings/guest
     │                             ├────────────────────────>│
     │                             │                        Insert booking
     │                             │                        with:
     │<─ Success & Token ────────│ - tripType: "defined_trip"
     │                             │ - source: "guest_booking"
     │                             │<───────────────────────┤
     │                             │                        │
     ├─ Show Popup ──────────────>│ (3-4 sec auto-close)  │
```

### Example 2: User Books Trip
```
Client Browser                 FastAPI Server              MongoDB
     │                              │                        │
     ├─ Login ───────────────────>│                        │
     │                              │ Verify credentials    │
     │                              ├───────────────────────>│
     │<─ JWT Token ───────────────│<───────────────────────┤
     │                              │                        │
     ├─ Go Home ─────────────────>│                        │
     │                              │ (Token in header)      │
     │                              │                        │
     ├─ Click "Book" ────────────>│                        │
     │                              │ GET /api/user/profile  │
     │                              ├───────────────────────>│
     │<─ Direct Booking ──────────│ Fetch from DB          │
     │                              │<───────────────────────┤
     │                              │                        │
     │                              │ POST /api/bookings/user│
     │                              ├───────────────────────>│
     │                             │                        Insert booking
     │<─ Success Popup ──────────│ - source: "logged_in"   │
     │                             │<───────────────────────┤
```

---

## 🎨 Frontend Architecture

```
┌─────────────────────────────────────────┐
│        Frontend (No Frameworks)         │
│        Just HTML/CSS/Vanilla JS         │
└─────────────────────────────────────────┘

Pages:
├─ index.html (Home)
│  ├─ Hero section
│  ├─ Trip cards (grid)
│  ├─ Search functionality
│  ├─ Book popups (modal)
│  └─ Plan trip form
│
├─ auth.html (Authentication)
│  ├─ Signup form
│  ├─ Login form
│  ├─ Role selector
│  └─ Status messages
│
├─ user-dashboard.html (User Profile)
│  ├─ Left sidebar (profile)
│  ├─ Upcoming trips
│  └─ Completed travels
│
└─ admin-dashboard.html (Admin)
   ├─ Dashboard & Stats
   ├─ Booking Details
   └─ Add Trip Form

Styling:
├─ styles.css (Global)
├─ auth.css (Auth page)
└─ dashboard.css (Dashboard pages)

Scripts:
├─ script.js (Home logic)
├─ auth.js (Auth logic)
├─ user-dashboard.js (User profile)
└─ admin-dashboard.js (Admin functions)
```

---

## 📊 Database Relationships

```
user_login ──────────┐
    │                │
    └──── Unique on email
         Password stored

admin_login ──────────┐
    │                 │
    └──── Unique on username
         Password stored

add_trip_detail ──────────────────────┐
    │                                  │
    └──── Unique on slug (for SEO)
         Contains: title, location, price, dates, image

user_trip_details ────────────────┐
    │                             │
    ├──── Foreign key: tripId ────────> add_trip_detail._id
    │     (if defined_trip)       │
    │                             │
    ├──── Indexed on: createdAt   │
    ├──── Indexed on: dateOfTravel│
    └──── Indexed on: email       │

Booking Sources:
├─ guest_booking (non-logged-in)
├─ logged_in_direct_booking (user)
└─ planned_trip_form (custom trip)
```

---

## 🚀 Deployment Architecture

```
Production Deployment:
│
├─ Frontend Files
│  ├─ HTML files
│  ├─ CSS files
│  ├─ JavaScript files
│  └─ Assets (images)
│
├─ FastAPI Server
│  ├─ Python 3.9+
│  ├─ Uvicorn ASGI
│  ├─ app/main.py
│  └─ On Linux/Cloud
│
├─ Database
│  ├─ MongoDB Atlas (cloud)
│  └─ Or MongoDB Community
│
└─ Network
   ├─ HTTPS/SSL
   ├─ Domain name
   └─ Load balancer (optional)
```

---

This architecture ensures:
✅ **Scalability** - Can handle thousands of bookings
✅ **Security** - JWT, password hashing, input validation
✅ **Performance** - Fast API responses, indexed database
✅ **Maintainability** - Clear separation of concerns
✅ **Reliability** - Error handling throughout
✅ **User Experience** - Smooth, responsive interface
