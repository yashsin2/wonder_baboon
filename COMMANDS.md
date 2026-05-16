# Setup & Run Commands - Wonder Baboon

## 📋 One-Time Setup

### Copy and paste these commands to set up:

```bash
# Navigate to project
cd "/Users/apple/Downloads/Wonder baboon"

# Activate virtual environment
source .venv/bin/activate

# Install/verify dependencies
pip install -r requirements.txt

# Done! Setup complete
echo "✅ Setup complete!"
```

---

## 🚀 Start the System

### Copy and paste to start server:

```bash
cd "/Users/apple/Downloads/Wonder baboon"
source .venv/bin/activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 5051
```

**Expected output:**
```
INFO:     Uvicorn running on http://127.0.0.1:5051
INFO:     Application startup complete
```

---

## 🌐 Access in Browser

Click these links after server is running:

- **Home Page**: http://localhost:5051
- **Login Page**: http://localhost:5051/auth.html
- **User Dashboard**: http://localhost:5051/user-dashboard.html
- **Admin Dashboard**: http://localhost:5051/admin-dashboard.html

---

## 🧪 Quick Test Commands

### Check server is running:
```bash
curl http://localhost:5051/api/health
```
**Should return**: `{"ok":true}`

### Get all trips:
```bash
curl http://localhost:5051/api/trips | python -m json.tool
```

### MongoDB - Check data:
```bash
# Open MongoDB client
mongosh

# Check collections
use userlogindetails
db.user_trip_details.find().pretty()
db.add_trip_detail.find().pretty()
db.user_login.find().pretty()
db.admin_login.find().pretty()

# Count bookings
db.user_trip_details.countDocuments({})

# Exit
exit
```

---

## 🔑 Test Credentials

### Admin Login
- **Username**: `wb_admin`
- **Password**: `WB_Admin@2026`

### Create Test User
- Go to http://localhost:5051/auth.html
- Fill "Create User Account"
- Password must have: uppercase, lowercase, digit, min 8 chars
- Example: `TestPass123`

---

## 📝 Useful Commands

### Stop Server
Press `Ctrl + C` in terminal

### Restart Python Environment
```bash
deactivate
source .venv/bin/activate
```

### Check Python Version
```bash
python --version
```

### Check Installed Packages
```bash
pip list
```

### Install Specific Package
```bash
pip install package-name
```

---

## 🐛 Troubleshooting Commands

### Clear Browser Data
```bash
# Press F12 in browser
# Application → localStorage → Clear all
# Application → Cookies → Delete all
```

### Reload CSS/JS Cache
```
Ctrl + Shift + R  (hard refresh)
```

### Check Port Usage
```bash
lsof -i :5051
```

### Kill Process on Port (if needed)
```bash
kill -9 <PID>
```

### Check MongoDB Connection
```bash
mongosh
# If not installed: brew install mongodb-community
```

### Reset Admin Password
Edit `.env` file and restart server:
```
ADMIN_PASSWORD=YourNewPassword123
```

---

## 📊 MongoDB Backup/Restore

### Export Collections
```bash
mongoexport --db userlogindetails --collection user_trip_details --out bookings.json
mongoexport --db userlogindetails --collection add_trip_detail --out trips.json
mongoexport --db userlogindetails --collection user_login --out users.json
```

### Import Collections
```bash
mongoimport --db userlogindetails --collection user_trip_details --file bookings.json
mongoimport --db userlogindetails --collection add_trip_detail --file trips.json
mongoimport --db userlogindetails --collection user_login --file users.json
```

---

## 🔧 Development Tips

### View Server Logs
```bash
# Server logs appear in terminal while running
# Ctrl + C to stop and see summary
```

### Debug Mode
```bash
# Logs are already verbose with --reload flag
# See requests and responses in terminal
```

### Test Endpoints with cURL

#### Get Trips
```bash
curl http://localhost:5051/api/trips
```

#### Admin Stats (with token)
```bash
curl -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  http://localhost:5051/api/admin/stats
```

#### Test User Registration
```bash
curl -X POST http://localhost:5051/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "mobile": "9876543210",
    "password": "TestPass123"
  }'
```

---

## 📚 File Locations

| Item | Path |
|------|------|
| Python Backend | `/app/main.py` |
| Home Page | `/index.html` |
| Login Page | `/auth.html` |
| User Dashboard | `/user-dashboard.html` |
| Admin Dashboard | `/admin-dashboard.html` |
| Styles | `/styles.css`, `/auth.css`, `/dashboard.css` |
| Scripts | `/script.js`, `/auth.js`, `/user-dashboard.js`, `/admin-dashboard.js` |
| Images | `/assets/` |
| Docs | `/README.md`, `/QUICK_START.md`, `/IMPLEMENTATION.md` |
| Environment | `/.env` |
| Dependencies | `/requirements.txt` |

---

## ⏰ Typical Workflow

```
1. Terminal 1: Start Server
   $ cd "Wonder baboon"
   $ source .venv/bin/activate
   $ python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 5051

2. Browser: Open Application
   - http://localhost:5051 (home)
   - Test booking
   - Go to login and test

3. Terminal 2: Monitor Data (optional)
   $ mongosh
   $ use userlogindetails
   $ db.user_trip_details.find().pretty()

4. When Done:
   - Terminal 1: Ctrl + C to stop server
   - Close browser
   - Deactivate: deactivate
```

---

## 🎯 Common Tasks

### Add New Trip via Admin
1. Login as admin (username: wb_admin)
2. Go to "Add Trip" tab
3. Fill form with trip details
4. Image name must exist in `/assets/` folder
5. Click "Add Trip to Database"

### Check User Bookings
1. Login as user
2. Go to `/user-dashboard.html`
3. See profile and booking history
4. Dates in past show in "Completed Travels"
5. Dates in future show in "Upcoming Trips"

### Search Admin Bookings
1. Login as admin
2. Go to "Booking Details" tab
3. Enter search term (destination/name/phone)
4. Click "Search Bookings"
5. Results appear below

### Test Different User Roles
```
Guest (not logged in)    → See trips, book with form
User (logged in)         → Book directly, see history
Admin                    → Manage trips and bookings
```

---

## 📞 Need Help?

- **Installation Issues**: See README.md
- **Quick Start**: See QUICK_START.md
- **Implementation Details**: See IMPLEMENTATION.md
- **API Documentation**: See README.md (API Endpoints section)

---

**Ready to go! 🚀**

Run the "Start the System" commands above and you'll be live in 30 seconds!
