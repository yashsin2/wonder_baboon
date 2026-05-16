# Wonder Baboon - Travel Booking System

A modern, colorful backpacker travel booking platform built with **FastAPI** backend and vanilla JavaScript frontend.

## 🎯 Project Overview

Wonder Baboon is a travel app designed for backpackers to discover and book adventure trips. The system supports three types of users:

1. **Guest Users** (not logged in) - Can browse trips and book with form submission
2. **Registered Users** (logged in) - Can directly book from saved profile information
3. **Admins** - Can manage trips and view detailed booking analytics

## 🏗️ Tech Stack

- **Backend**: FastAPI with Python 3.9+
- **Database**: MongoDB
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **No Node.js dependencies** - Pure Python backend only

## 📋 System Features

### User Features
- ✅ User registration and login (unified auth page)
- ✅ Browse available trips with search
- ✅ Book trips (with/without login)
- ✅ View booking history and upcoming trips
- ✅ User profile dashboard with left sidebar
- ✅ Plan custom trips

### Admin Features
- ✅ Unified admin login (same page as user login)
- ✅ Dashboard with detailed stats
  - Total trips in database
  - Total bookings (defined + planned)
  - Monthly booking analytics
- ✅ Scrollable trip cards with search
- ✅ View all bookings with search/filter
- ✅ Add new trips to database
- ✅ Image management from assets folder

### Booking System
- 📌 **Defined Trips**: Admin-created trips from `add_trip_detail` collection
- 🎯 **Planned Trips**: User-created custom trip plans
- 👤 **Guest Bookings**: Non-logged-in users fill form for each booking
- 🔐 **User Bookings**: Logged-in users book directly using saved profile

## 📁 Project Structure

```
Wonder baboon/
├── frontend/          # HTML, CSS, TypeScript → compiled JS
│   ├── src/           # TypeScript source (.ts)
│   ├── js/            # Compiled JavaScript output
│   ├── assets/
│   ├── package.json   # npm start
│   └── *.html, *.css
├── backend/           # FastAPI API only
│   ├── main.py        # Routes
│   ├── config.py
│   ├── models.py
│   ├── auth_utils.py
│   ├── services/
│   │   └── mongo_service.py   # All MongoDB operations
│   └── requirements.txt
└── .env                   # Environment variables
```

## 🚀 Installation & Setup

### 1. Prerequisites
- Python 3.9+
- MongoDB running locally or MongoDB Atlas connection string
- Virtual environment (recommended)

### 2. Install Python Dependencies

```bash
cd "Wonder baboon"

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Create/update `.env` file:

```
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
JWT_SECRET=your-secret-key-change-this
ADMIN_USERNAME=wb_admin
ADMIN_PASSWORD=WB_Admin@2026
```

**Note**: Change `JWT_SECRET` and admin credentials to secure values in production.

### 4. Start the FastAPI Server

```bash
cd "Wonder baboon"

# Run FastAPI with Uvicorn
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 5051
```

The server will be available at: `http://localhost:5051`

### 5. Access the Application

Open in browser:
- **Home Page**: http://localhost:5051
- **Login Page**: http://localhost:5051/auth.html

## 📝 Database Schema

### Collections

#### `user_login`
```javascript
{
  name: String,
  email: String (unique),
  mobile: String,
  password_hash: String,
  role: "user",
  createdAt: Date
}
```

#### `admin_login`
```javascript
{
  username: String (unique),
  password_hash: String,
  createdAt: Date
}
```

#### `add_trip_detail`
```javascript
{
  title: String,
  slug: String (unique),
  location: String,
  durationLabel: String,
  price: Number,
  startDate: Date,
  endDate: Date,
  imageUrl: String,
  published: Boolean,
  createdAt: Date
}
```

#### `user_trip_details`
```javascript
{
  tripType: "defined_trip" | "planned_trip",
  tripId: String,
  travelDestination: String,
  dateOfTravel: Date,
  fullName: String,
  mobile: String,
  email: String,
  numberOfPeople: Number,
  source: "guest_booking" | "logged_in_direct_booking" | "planned_trip_form",
  createdAt: Date
}
```

## 🔐 API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login (user or admin)

### Trips
- `GET /api/trips` - Get all published trips
- `GET /api/admin/trips` - Get all trips (admin only, with search)
- `POST /api/admin/trips` - Add new trip (admin only)

### Bookings
- `POST /api/bookings/guest` - Guest booking
- `POST /api/bookings/user` - Logged-in user booking
- `POST /api/planned-trips` - Create planned trip
- `GET /api/admin/bookings` - Get all bookings (admin only, with search)

### User
- `GET /api/user/profile` - Get user profile
- `GET /api/user/bookings` - Get user's bookings and travel history

### Admin
- `GET /api/admin/stats` - Get dashboard statistics

## 🎨 Design & Theming

**Color Scheme:**
- Primary: `#ccff00` (Lime Green)
- Dark Background: `rgba(20, 24, 18, 0.85)`
- Light Background: `#f7f3eb`
- Text: `#fff`

**Typography:**
- Headers: Bold, uppercase
- Logo: 'Permanent Marker' font
- Clean, modern interface inspired by backpacker culture

## 🧪 Testing Guide

### 1. Test Guest Booking Flow
1. Open http://localhost:5051
2. Click "Book" on any trip (without logging in)
3. Fill in trip details popup
4. See "Our team will contact you soon" message
5. Check MongoDB: `user_trip_details` collection should have the booking

### 2. Test User Login & Booking
1. Go to http://localhost:5051/auth.html
2. Click "Sign Up" - create account (password must have uppercase, lowercase, digit)
3. Login with your credentials
4. Go back to home, click "Book" on a trip
5. Should book directly without form (uses saved profile)
6. Check user-dashboard.html for booking history

### 3. Test Admin Dashboard
1. Go to http://localhost:5051/auth.html
2. Select "Admin" in login dropdown
3. Username: `wb_admin`, Password: `WB_Admin@2026`
4. Should see admin dashboard with stats
5. Navigate tabs:
   - **Dashboard & Stats**: View analytics for current month
   - **Booking Details**: Search bookings by destination/name/mobile
   - **Add Trip**: Add new trip (image must exist in assets/)

### 4. Test Planned Trip
1. On home page, fill "Plan Trip" section
2. Enter destination and date
3. Click "Plan Trip"
4. Complete the form modal
5. Booking saved to `user_trip_details` with `tripType: "planned_trip"`

### 5. Check Previous Travels (User Dashboard)
1. Login as user
2. Go to user-dashboard.html
3. Should see profile in left sidebar
4. Upcoming trips (future dates)
5. Completed travels (past dates)

## 🔧 Troubleshooting

### Server won't start
```bash
# Check Python version
python --version  # Should be 3.9+

# Check dependencies installed
pip list | grep -E "fastapi|uvicorn|pymongo"

# Reinstall requirements
pip install --upgrade -r requirements.txt
```

### MongoDB connection error
```bash
# Verify MongoDB is running
# For local: mongod should be running
# For Atlas: Check connection string in .env

# Test connection with Python
python -c "from pymongo import MongoClient; print(MongoClient('mongodb://localhost:27017/'))"
```

### Bookings not saving
1. Check MongoDB connection in console
2. Verify `MONGO_URI` in .env is correct
3. Check browser console for fetch errors
4. Ensure user is logged in for user bookings

### Login not working
1. Check password requirements (must have: uppercase, lowercase, digit)
2. Verify admin credentials match .env values
3. Check JWT_SECRET is set in .env
4. Clear localStorage: Open DevTools → Application → localStorage → Clear all

## 📊 Monitoring & Analytics

Admin dashboard provides:
- **Real-time stats**: Total trips, bookings, monthly data
- **Trip management**: Add, view, search trips
- **Booking analytics**: Filter by destination, name, phone
- **Source tracking**: See if booking from guest, logged-in, or planned trip

## 🌍 Deployment Notes

For production deployment:
1. Change JWT_SECRET to a strong random value
2. Change admin password in .env
3. Use MongoDB Atlas or managed MongoDB service
4. Use environment variables for all secrets
5. Enable CORS for your domain
6. Use HTTPS in production
7. Consider adding rate limiting
8. Set up logging and monitoring

## 📞 API Response Examples

### Successful User Login
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "role": "user",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

### Admin Stats Response
```json
{
  "totalTrips": 10,
  "totalBookings": 45,
  "definedTripBookings": 30,
  "plannedTripBookings": 15,
  "monthBookings": 12,
  "currentMonth": "May 2026"
}
```

### User Bookings Response
```json
{
  "bookings": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "tripType": "defined_trip",
      "travelDestination": "Spiti Circuit",
      "dateOfTravel": "2026-06-15",
      "fullName": "John Doe",
      "numberOfPeople": 2,
      "createdAt": "2026-05-12T10:30:00Z"
    }
  ]
}
```

## 🎯 Key Implementation Details

### Booking Popup Flow
1. User clicks "Book" on trip card
2. If logged in → Direct booking with user profile
3. If not logged in → Show trip details popup
4. After booking → Show 3-4 second notification "Our team will contact you soon"
5. Data saved to `user_trip_details` collection

### Admin Authentication
- Same login page as users
- Select "Admin" from dropdown
- Username + password (not email)
- Creates JWT token with `role: "admin"`

### Trip Images
- Images stored in `assets/` folder
- Reference by filename (e.g., `lake.JPG`)
- When adding trip, provide just the filename
- ImageUrl stored as `./assets/{filename}`

### Password Security
- PBKDF2-HMAC-SHA256 hashing
- 200,000 iterations
- Random salt for each password
- Constant-time comparison (prevents timing attacks)

## 📄 License

This project is part of the Wonder Baboon travel platform.

---

**Last Updated**: May 12, 2026
**Version**: 1.0.0
**Status**: Production Ready
