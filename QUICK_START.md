# Quick Start Guide - Wonder Baboon

## 🚀 Start the System (5 minutes)

### 1. Open Terminal
```bash
cd "/Users/apple/Downloads/Wonder baboon"
```

### 2. Activate Python Environment
```bash
source .venv/bin/activate
```

### 3. Start FastAPI Server
```bash
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 5051
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:5051
INFO:     Application startup complete
```

### 4. Open Browser
```
http://localhost:5051
```

## 🧪 Quick Test Flow (5 minutes)

### Test 1: Browse Trips as Guest
1. Home page shows trip cards
2. Click "Book" on any trip
3. Fill form with name, mobile, email, date, people
4. Click "Submit Booking"
5. See popup: "Booking done. Our team will contact you soon."

### Test 2: Register & Login
1. Click "Login" in header → Goes to auth.html
2. Fill "Create User Account" section:
   - Name: John Doe
   - Email: john@example.com
   - Mobile: 9876543210
   - Password: TestPass123 (must have uppercase, lowercase, digit)
3. Click "Sign Up"
4. Auto-logged in, goes to user dashboard

### Test 3: User Dashboard
- See profile on left sidebar
- Upcoming trips (future dates)
- Completed travels (past dates)
- Each trip shows: destination, date, people, booking date

### Test 4: Admin Dashboard
1. Go to auth.html
2. Select "Admin" from dropdown
3. Enter:
   - Username: `wb_admin`
   - Password: `WB_Admin@2026`
4. Click "Login" → Admin Dashboard

### Admin Dashboard Tabs:
- **Dashboard & Stats**: Shows 6 stat cards with current analytics
- **Booking Details**: Search bookings, see all details
- **Add Trip**: Add new trip to database

## 📱 Key URLs

| Page | URL |
|------|-----|
| Home | http://localhost:5051 |
| Login | http://localhost:5051/auth.html |
| User Dashboard | http://localhost:5051/user-dashboard.html |
| Admin Dashboard | http://localhost:5051/admin-dashboard.html |

## 🔑 Test Credentials

### Admin Account
- **Username**: wb_admin
- **Password**: WB_Admin@2026

### Test User (create your own)
- Any email address
- Password must have: 1 uppercase, 1 lowercase, 1 digit (min 8 chars)
- Mobile: Any valid Indian number (starts with 6-9, 10+ digits)

## ✅ Features to Test

- [x] Guest booking flow
- [x] User registration
- [x] User login
- [x] Admin login
- [x] View trips on home
- [x] User dashboard with profile
- [x] User booking history
- [x] Admin stats dashboard
- [x] Admin booking search
- [x] Admin trip management
- [x] Planned trips
- [x] Booking confirmation popup

## 🐛 If Something Goes Wrong

### Server won't start
```bash
# Check if port 5051 is free
lsof -i :5051
# Kill if needed: kill -9 <PID>

# Verify MongoDB is running
# Should see no error in server logs
```

### Login not working
1. Check admin credentials (case-sensitive)
2. Check password meets requirements
3. Clear browser localStorage: F12 → Application → localStorage → Clear all

### Bookings not saving
1. Check MongoDB connection is working
2. Check .env has valid MONGO_URI
3. Check browser console (F12) for fetch errors

### Page not loading
1. Make sure FastAPI server is running
2. Check http://localhost:5051/api/health returns `{"ok":true}`
3. Clear browser cache: F12 → Application → Clear site data

## 📊 Check MongoDB Directly

To verify data is being saved:

```bash
# Open MongoDB client (if using local)
mongosh

# Or use MongoDB Compass GUI

# Check collections
db.user_trip_details.find()
db.admin_login.find()
db.user_login.find()
db.add_trip_detail.find()
```

## 🎨 UI Features

### Home Page (index.html)
- Colorful hero section with trip search
- Scrollable trip cards
- Plan custom trip form
- Mobile responsive

### Auth Page (auth.html)
- Unified login/signup
- Toggle between user and admin login
- Form validation
- Status messages

### User Dashboard (user-dashboard.html)
- Left sidebar with profile
- Upcoming trips section
- Completed travels section
- Shows: destination, date, people, booking type

### Admin Dashboard (admin-dashboard.html)
- 6 stat cards (trips, bookings, types, month)
- Scrollable trip cards with search
- Booking list with advanced search
- Add new trip form with validation
- All styled with lime green (#ccff00) theme

## 💾 Database Auto-Setup

On first run, FastAPI automatically:
1. Creates all collections
2. Creates indexes for performance
3. Adds default admin user (wb_admin)
4. Seeds 4 sample trips

## 🚀 Next Steps

1. **Test everything** - Follow the quick test flow
2. **Check MongoDB** - Verify bookings are saved
3. **Customize** - Change colors, add more trips, modify text
4. **Deploy** - See README.md for production setup

---

**All set! 🎉 Your Wonder Baboon system is ready!**
