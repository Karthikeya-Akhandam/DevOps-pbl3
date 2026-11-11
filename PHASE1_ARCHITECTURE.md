# Vehicle Rental System Architecture

## 1. Simple system explanation
The app is a locally runnable modular monolith. Express supports both a local JSON demo store and a MySQL-backed mode. When `DB_HOST` is configured, the backend uses MySQL Server and seeds an empty catalogue; otherwise it runs from a JSON file.

- Auth module handles registration, login, and role checks.
- Vehicle module handles adding and updating vehicles.
- Availability module checks overlap and booking windows.
- Pricing module calculates a fair price from rules and demand.
- Booking module creates and manages reservations safely.
- Payment module simulates a checkout flow and stores transaction status.
- Analytics module aggregates bookings, utilization, and revenue.

This structure allows future growth without rewriting the whole system.

## 2. Customer booking flow
1. Customer opens the home page and searches for a vehicle.
2. Customer chooses pickup and return dates and times.
3. Backend checks availability for the vehicle on that interval.
4. Pricing engine calculates the total using base rate + simulated city/category demand + availability + peak + discount rules.
5. Customer gets a quote and can either accept or modify the dates.
6. Booking is created only after quote validation and payment handling.
7. The system records the booking with a snapshot of the agreed price.

## 3. Core entities
- User: email, password hash, role, name, account status
- Vehicle: model, type, capacity, daily rate, location, status
- RentalLocation: branch name, address, timezone, metadata
- Reservation: vehicle, user, pickup, return, status, snapshot
- PricingRule: name, type, multiplier, enabled flag, priority
- DemandMetric: time window, demand score, vehicle type or location context
- PriceQuote: vehicle, period, total, rule version, expiry, breakdown
- Payment: booking, provider, status, transaction reference
- MaintenancePeriod: vehicle, start, end, reason
- AuditLog: actor, action, entity type, metadata, timestamp

## 4. Folder structure
workspace/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── layouts/
│   │   ├── services/
│   │   ├── hooks/
│   │   └── utils/
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   ├── store.js
│   │   └── pricing.js
│   ├── test/
│   └── .env.example
├── sql/
│   └── schema.sql
├── .gitignore
├── README.md
└── PHASE1_ARCHITECTURE.md

## 5. Build sequence
1. Run the frontend and backend using local file-backed demo data.
2. Verify registration, vehicle search, pricing, booking, and mock payment workflows.
3. Configure the backend's local MySQL connection values and start the API; the first MySQL startup seeds demo catalogue and pricing data.
4. Add integration tests for database transactions and concurrent bookings.

## 6. Security notes
- Use bcrypt/argon2 for passwords.
- Use JWT with secure config.
- Validate all request bodies.
- Restrict admin routes by role.
- Never expose admin secrets to frontend.

## 7. Current storage boundary
MySQL Workbench is a client application; MySQL Server is the database. Run `sql/schema.sql` in Workbench, then configure the backend connection in the ignored `backend/.env` file. MySQL mode persists customer and administrator data, pricing, quotes, reservations, payments, and audit history. Booking creation checks reservation and maintenance overlaps while holding a vehicle-row lock. The API currently loads its working catalogue into process memory at startup and is intended to run as one local backend process; the JSON file store remains available for tests and local demonstrations.
