# Scalable Vehicle Rental System with Dynamic Pricing

A locally runnable React + Express vehicle rental project. It includes customer registration/sign-in, vehicle search, live availability and price quotes, bookings, a mock payment flow, and an administrator dashboard for fleet and pricing management.

**No Docker or cloud account is required.** The backend supports local JSON demo storage or MySQL Server storage. MySQL Workbench is used to create the schema; the backend connects directly to MySQL Server.

## Requirements

- Node.js 20 LTS or later (includes npm)
- VS Code (or another editor)
- For MySQL mode: MySQL Server 8.0 or later and MySQL Workbench.

## Run locally on Windows

Open the workspace folder in VS Code. In the first PowerShell terminal:

```powershell
cd .\backend
Copy-Item .env.example .env
```

Edit `backend\.env` and set `JWT_SECRET` (at least 32 characters), `ADMIN_PASSWORD`, and your local MySQL connection values (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`). Do not share or commit this file. When `DB_HOST` is set, the backend uses MySQL; if it is blank or omitted, the app uses the JSON demo store. Then install and start the API:

```powershell
npm install
npm run dev
```

The backend reports `API listening at http://localhost:5000`. In MySQL mode, check `http://localhost:5000/api/health`; its `database` value is `mysql`. The first run seeds the demo catalogue and default pricing settings if the database has no vehicles.

Open a second VS Code terminal:

```powershell
cd .\frontend
npm install
npm run dev
```

Open the local address Vite prints (normally `http://localhost:5173`).

## Demo accounts and data

- The first backend start creates an administrator using `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend\.env`.
- Customers create their own accounts using Register.
- A demonstration catalogue of 36 vehicle models across each of 12 cities (432 city-specific listings) and multiple pickup areas is loaded automatically at startup.
- With MySQL configured, users, vehicles, pricing settings, quotes, reservations, payments, maintenance, price history, and audit records are persisted to MySQL. The demo catalogue is seeded on first startup of an empty database.
- With MySQL not configured, data is persisted in `backend\data\store.json`. This local JSON mode is intended for development/demo use and not for multiple server processes.

## Included workflows

### Customer

- Register and sign in; public registration always creates a `CUSTOMER`.
- Search vehicles by city, pickup area, category, vehicle type, dates, and price; date filters hide listings with overlapping bookings or maintenance. Sort and compare listings.
- Demo daily prices are tiered: bikes and scooters ₹500–₹1,800, high-end bikes ₹2,000–₹4,000, commercial vehicles ₹4,100–₹4,400, cars ₹4,500–₹8,500, and high-end cars ₹9,500–₹16,000. Category-specific rate limits keep dynamic quotes within the selected vehicle tier.
- Request a server-generated hourly or daily quote for dates.
- Review vehicle details, itemized price breakdown, demand/availability/peak adjustments, configured price limits, discounts, currency, and quote expiry.
- Create a temporary booking hold and complete simulated success/failure payment.
- Review booking history and cancel eligible future bookings (more than 24 hours before pickup).

### Administrator

- Sign in using the configured initial administrator account.
- View fleet, confirmed booking count, paid revenue, cancellations, utilization, and recent bookings.
- Add and deactivate vehicles, manage peak periods, and schedule maintenance periods.
- Configure demand score thresholds and multipliers, availability ratios and multipliers, fees, tax, and discounts; compare pricing scenarios in the simulator.
- Add/deactivate peak periods.
- API supports recording/removing vehicle maintenance periods and changing booking status.
- Administrative actions are stored in the audit log.

### Pricing rules in the local MVP

- Requests under 24 hours use hourly rates, rounded up to whole hours; longer requests use daily rates, rounded up to whole days.
- Demand uses a simulated city/category demand score for the selected vehicle's area. The data is explicitly marked as demonstration data.
- Availability compares rentable vehicles in the same city and category against overlapping bookings and maintenance periods.
- Active peak periods apply their configured multiplier.
- Rate floor and ceiling are applied to each hourly/daily rate before duration discounts.
- Rentals of three days or longer receive the configured duration discount.
- A quote is rechecked server-side when the booking hold is requested. The booking keeps a snapshot of its price breakdown.
- Rental intervals use the half-open convention `[pickup, return)`. An unexpired pending hold or confirmed booking blocks overlaps.
- Mock payments do not process or store real payment credentials.

## Tests

From `backend`:

```powershell
npm test
```

The automated tests cover hourly/daily pricing, rounding, rate floor/ceiling, duration discounts, tax, API registration, role checks, quote/booking flow, overlap rejection, and payment idempotency. Tests use a temporary JSON store and do not require a live MySQL server.

## Connect with MySQL Workbench

MySQL Workbench is a database client; **MySQL Server** is the database the backend connects to.

1. Start MySQL Server and connect to it in Workbench.
2. Run [`sql/schema.sql`](./sql/schema.sql) in the Workbench SQL editor. It creates the `vehicle_rental` database and required tables.
3. Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `backend\.env`. Use a MySQL account with access to the schema.
4. Start the API with `npm run dev` from `backend`. On first startup, the app seeds its fresh demo catalogue; on later startups it loads the persisted records.
5. Confirm the API responds at `http://localhost:5000/api/health` with `"database":"mysql"`. The vehicle catalogue is available at `http://localhost:5000/api/vehicles`.

Booking creation checks overlapping reservations and maintenance periods in a MySQL transaction while locking the vehicle row. Credentials stay in the local, git-ignored `.env` file; never paste them into chat or commit them.

## Project layout

```text
backend/
  src/
    pricing.js        # isolated, tested pricing calculation
    server.js         # REST API and workflows
    store.js          # selects MySQL or local file storage
    mysqlStore.js     # MySQL seed, repository, persistence, and booking transaction
  test/
    pricing.test.js
frontend/
  src/
    App.jsx           # customer pages and admin dashboard
    api.js            # API client
    styles.css
sql/
  schema.sql          # MySQL 8.0 schema
```

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/vehicles`, `GET /api/vehicles/:id`, `GET /api/locations`
- `POST /api/pricing/quote`
- `POST /api/bookings`, `GET /api/bookings/my`, `POST /api/bookings/:id/cancel`
- `POST /api/payments/mock-checkout`
- Admin: `/api/admin/dashboard`, `/bookings`, `/vehicles`, `/pricing-settings`, `/peak-dates`, `/maintenance-periods`, `/price-history`, `/audit-logs`
- `GET /api/health`

All protected routes require `Authorization: Bearer <token>`. Admin endpoints also verify the account role on the server.

## Project status and limitations

The JSON mode is a single-process demo implementation. MySQL mode persists application data and uses a database transaction for booking overlap checks; payment remains simulated and demand data is demonstration data. The API currently loads its working catalogue into process memory at startup, so run one backend process; this local project is not yet a horizontally scaled production deployment. Cloud deployment and Docker are intentionally out of scope.
