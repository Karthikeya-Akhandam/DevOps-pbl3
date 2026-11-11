# Roam — Scalable Vehicle Rental System with Dynamic Pricing

## Project overview

Roam is a locally runnable vehicle-rental application built to demonstrate the full customer journey: browse vehicles, check availability, receive a transparent date-specific quote, place a temporary booking hold, and complete a simulated payment. An administrator can manage fleet details, pricing settings, peak dates, maintenance windows, bookings, and audit activity.

The project is designed for local development with a React frontend, an Express API, and MySQL Server for persisted application data. MySQL Workbench is used to create and inspect the database; it is a database client, not the database server. No Docker or cloud deployment is required.

## Goals and reasons for the design

- **A usable end-to-end demo:** Customer registration, search, pricing, booking, simulated checkout, and receipt/history are connected rather than being isolated screens.
- **Price transparency:** Quotes include a breakdown of the factors that affect the total, so a customer can see how the amount was calculated before booking.
- **Availability-aware rentals:** A vehicle cannot be quoted or booked when an overlapping active reservation, unexpired hold, or maintenance block makes it unavailable.
- **An administrator workflow:** Fleet and dynamic-pricing controls can be demonstrated from the app without manually changing database rows.
- **Local-first setup:** The application runs on a developer's Windows machine and connects to a locally managed MySQL Server. A JSON mode remains available for automated tests and database-free development.
- **A path to future scaling:** Data entities have explicit relational tables, and booking creation uses a database transaction and vehicle-row lock. The current API still loads its working data into one process's memory, so it is a local single-backend-process MVP, not a horizontally scaled production service.

## What has been implemented

### Customer experience

- Account registration and sign-in; passwords are stored as bcrypt hashes.
- Browse and filter by city, pickup area, category, vehicle type, fuel, transmission, seating capacity, and base daily price.
- A seeded demonstration fleet of 36 models in each of 12 cities (432 city-specific listings), with candidate pickup locations.
- Vehicle cards are hidden until the user selects **Show vehicles**.
- Vehicle comparison and a details view with a path to the booking/pricing page.
- Quote requests for a selected rental interval, with hourly or daily pricing.
- Temporary booking holds, simulated payment success/failure, booking history, eligible cancellation, and a receipt with the saved price breakdown.

### Admin experience

- Initial administrator account creation from local environment configuration.
- Dashboard showing fleet and booking metrics, cancellations, and simulated paid revenue.
- Add, edit, and deactivate vehicles.
- Configure demand and availability thresholds/multipliers, duration and early-booking discounts, booking fee, tax, and peak multiplier.
- Create/deactivate peak periods and schedule/remove maintenance periods.
- Review recent quotes and audit activity; update booking status through administrative actions.

### Backend and persistence

- Express REST API with validation, authentication/authorization middleware, rate limiting, and security headers.
- MySQL mode selected when `DB_HOST` is configured; local JSON persistence otherwise. Tests use an isolated temporary JSON store and do not require MySQL.
- MySQL schema for accounts, cities, rental locations, vehicle types, vehicles, pricing settings, demand metrics, peak dates, quotes, reservations, price snapshots, payments, maintenance periods, price history, and audit logs.
- On an empty MySQL catalogue, the API seeds demonstration cities, pickup locations, vehicle types, vehicles, demand metrics, and default pricing settings.
- Booking creation checks for overlapping reservations and maintenance inside a MySQL transaction while locking the vehicle row.
- The health endpoint reports the active storage mode, for example `mysql` or `local-file-store`.

## Dynamic pricing details

### Demonstration base-rate bands

The catalogue uses these indicative daily price bands. They are demonstration values, not real-time market prices:

| Vehicle tier | Daily base-rate band |
|---|---:|
| Bikes and scooters | ₹500–₹1,800 |
| High-end bikes | ₹2,000–₹4,000 |
| Commercial vehicles | ₹4,100–₹4,400 |
| Cars | ₹4,500–₹8,500 |
| High-end cars | ₹9,500–₹16,000 |

Each vehicle also has an hourly rate and a configured daily floor and ceiling. The quote engine applies the appropriate rate limits so dynamic adjustments stay within the vehicle's configured range.

### Quote calculation

1. Requests shorter than 24 hours use hourly rates, rounded up to whole hours. Longer requests use daily rates, rounded up to whole days.
2. The system starts with the vehicle's base hourly or daily rate multiplied by the number of billable hours or days.
3. A demand multiplier is selected from the simulated city/category demand metric and administrator-configured score thresholds.
4. An availability multiplier is selected by comparing available vehicles to the comparable city/category fleet for those dates.
5. An active peak-period multiplier may apply when a matching city/location date rule exists.
6. The rate floor and ceiling are applied.
7. Rentals of at least three days may receive the configured duration discount. An eligible early booking may also receive the configured early-booking discount.
8. The configured booking fee and tax are included; the API returns the itemized amounts and total.

The quote includes its rule version and expiry. The server rechecks availability and current pricing when a booking hold is requested. The booking keeps a snapshot of the agreed breakdown. Rental intervals use `[pickup, return)`: a reservation ending exactly when another begins does not overlap it. An unexpired pending hold or confirmed booking blocks an overlapping interval.

Demand metrics and inventory are seeded demonstration data. This version does not connect to a real marketplace feed, fleet GPS, or payment gateway. Checkout is simulated and must not be used to collect real payment credentials.

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | React 18, React Router, Vite, Axios, Recharts, CSS |
| Backend | Node.js (ES modules), Express 4 |
| Database access | MySQL Server 8+, `mysql2` promise driver |
| Database setup/inspection | MySQL Workbench and `sql/schema.sql` |
| Validation and security | Zod, bcryptjs, JSON Web Tokens, Helmet, express-rate-limit, CORS |
| Tests | Node.js built-in test runner (`node --test`) |

The file `mysql-connector-j-9.0.0.jar` is a Java/JDBC connector and is not used by this Node.js project. The backend connects to MySQL with the installed `mysql2` npm package.

## How the application is connected

```text
Browser (React/Vite at localhost:5173)
            │ HTTP / JSON API
            ▼
Express / Node.js (localhost:5000)
            │ mysql2 driver
            ▼
MySQL Server (vehicle_rental database)
            ▲
            │ schema creation and manual inspection
MySQL Workbench
```

Workbench runs the SQL schema against MySQL Server. The API reads database connection settings from `backend/.env`; never commit or share that file. `backend/.env.example` contains placeholders only.

## Run locally on Windows

Prerequisites: Node.js 20 LTS or later; for MySQL mode, MySQL Server 8 or later and MySQL Workbench.

1. In Workbench, connect to the local MySQL Server and run [`sql/schema.sql`](./sql/schema.sql).
2. In `backend/.env`, set `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and your MySQL `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`. Use the database name `vehicle_rental` if using the included schema.
3. Start the API in a VS Code terminal:

   ```powershell
   cd .\backend
   npm install
   npm run dev
   ```

4. Start the frontend in another VS Code terminal:

   ```powershell
   cd .\frontend
   npm install
   npm run dev
   ```

5. Open `http://localhost:5173/vehicles`. Check `http://localhost:5000/api/health`; MySQL mode should report `{"status":"ok","database":"mysql"}`.

The first MySQL startup seeds demo catalogue and default settings when the vehicles table is empty. Keep one backend process running for this local MVP. Do not copy passwords into source files, screenshots, or chat.

## Project structure

```text
backend/
  src/
    data/catalogue.js       # demo catalogue and initial settings
    mysqlStore.js           # MySQL seeding, persistence, and booking transaction
    pricing.js              # isolated pricing and demand calculations
    server.js               # REST API and application workflows
    store.js                # selects MySQL or local JSON mode
  test/                     # API integration, catalogue, and pricing tests
frontend/
  src/
    App.jsx                 # customer pages and admin dashboard
    api.js                  # frontend API client
    services/               # booking, pricing, and analytics API calls
    styles.css              # application styles
sql/
  schema.sql                # MySQL schema for vehicle_rental
README.md                   # setup and usage guide
PHASE1_ARCHITECTURE.md      # architecture overview
INFORENTAL.md               # complete project description
```

## Validation and known limitations

- Backend regression suite: `npm test` from the `backend` folder.
- Frontend production build: `npm run build` from the `frontend` folder.
- MySQL quote and booking/payment workflows have been exercised against the configured local MySQL Server.
- JSON-mode automated tests do not require a live database.
- This project is a local demonstration MVP: the working catalogue is loaded into process memory at startup, so use one backend process. It is not a horizontally scaled production deployment.
- Demand is simulated; payment is mocked; no Docker, AWS, or cloud deployment is included.

