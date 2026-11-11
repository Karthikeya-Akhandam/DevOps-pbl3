import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import api, { errorMessage } from "./api.js";
import { createBooking, getBooking, payMockBooking } from "./services/bookingService.js";
import { simulatePrice } from "./services/pricingService.js";
import { getAdminAnalytics } from "./services/analyticsService.js";

const money = (amount, currency = "INR") => new Intl.NumberFormat("en-IN", {
  style: "currency", currency, maximumFractionDigits: 2
}).format(Number(amount || 0));

function Header({ user, onLogout }) {
  return <header className="topbar"><Link className="brand" to="/">roam<span>.</span></Link>
    <nav><Link to="/vehicles">Explore</Link>{user && <Link to="/bookings">My bookings</Link>}
      {user?.role === "ADMIN" && <><Link to="/admin">Admin</Link><Link to="/admin/simulator">Pricing lab</Link></>}
      {user ? <button className="link-button" onClick={onLogout}>Sign out</button> : <Link to="/login">Sign in</Link>}
    </nav></header>;
}

function Home() {
  return <main>
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow">YOUR NEXT JOURNEY STARTS HERE</p>
        <h1>Move at your<br /><em>own pace.</em></h1>
        <p>Find the right ride for the road ahead. Cars, bikes and scooters, with clear prices before you book.</p>
        <Link className="button" to="/vehicles">Explore vehicles <span>↗</span></Link>
      </div>
      <div className="hero-photo"><div className="photo-tag">THE OPEN ROAD IS CALLING</div></div>
    </section>
    <section className="feature-row"><div><b>01</b><h3>Choose your ride</h3><p>Browse by type, location and budget.</p></div>
      <div><b>02</b><h3>See a fair quote</h3><p>Pricing responds to demand and peak dates.</p></div>
      <div><b>03</b><h3>Book with confidence</h3><p>Your confirmed price is saved with the booking.</p></div></section>
  </main>;
}

function AuthPage({ mode, onLogin }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";
  async function submit(event) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const { data } = await api.post(`/auth/${isRegister ? "register" : "login"}`, form);
      onLogin(data); navigate(location.state?.from || "/");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <main className="auth-page"><form className="panel auth-panel" onSubmit={submit}>
    <p className="eyebrow">{isRegister ? "JOIN ROAM" : "WELCOME BACK"}</p>
    <h1>{isRegister ? "Create your account" : "Sign in"}</h1>
    {isRegister && <label>Your name<input required minLength="2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>}
    <label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
    <label>Password<input required type="password" minLength={isRegister ? 8 : 1} autoComplete={isRegister ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
    {error && <p className="error">{error}</p>}<button disabled={busy}>{busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}</button>
    <p className="muted">{isRegister ? "Already registered?" : "New to Roam?"} <Link to={isRegister ? "/login" : "/register"}>{isRegister ? "Sign in" : "Create an account"}</Link></p>
  </form></main>;
}

function VehicleList({ user }) {
  const [vehicles, setVehicles] = useState([]);
  const [cities, setCities] = useState([]);
  const [locations, setLocations] = useState([]);
  const [filters, setFilters] = useState({
    q: "", cityId: "", locationId: "", category: "", fuelType: "", transmission: "",
    minSeats: "", maxRate: "", pickupAt: "", returnAt: "", sort: "price-asc"
  });
  const [comparison, setComparison] = useState([]);
  const [showVehicles, setShowVehicles] = useState(false);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");
  const [availabilityPrompt, setAvailabilityPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get("/cities").then(({ data }) => setCities(data)).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    api.get("/locations", { params: filters.cityId ? { cityId: filters.cityId } : {} })
      .then(({ data }) => {
        setLocations(data);
        if (filters.locationId && !data.some((location) => location.id === filters.locationId)) {
          setFilters((current) => ({ ...current, locationId: "" }));
        }
      }).catch((e) => setError(errorMessage(e)));
  }, [filters.cityId]);
  useEffect(() => {
    setLoading(true);
    const { pickupAt, returnAt, ...catalogueFilters } = filters;
    const params = Object.fromEntries(Object.entries(catalogueFilters).filter(([, value]) => value));
    if (Boolean(pickupAt) !== Boolean(returnAt)) {
      setVehicles([]);
      setError("");
      setAvailabilityPrompt("Enter both pickup and return dates to see available vehicles.");
      setLoading(false);
      return;
    }
    setAvailabilityPrompt(pickupAt && returnAt ? "Checking vehicles for your selected dates…" : "");
    if (pickupAt && returnAt) {
      const pickupDate = new Date(pickupAt);
      const returnDate = new Date(returnAt);
      if (!Number.isFinite(pickupDate.getTime()) || !Number.isFinite(returnDate.getTime()) || returnDate <= pickupDate) {
        setVehicles([]);
        setError("Return date and time must be after pickup.");
        setAvailabilityPrompt("");
        setLoading(false);
        return;
      }
      params.pickupAt = pickupDate.toISOString();
      params.returnAt = returnDate.toISOString();
    }
    api.get("/vehicles", { params })
      .then(({ data }) => {
        setVehicles(data);
        setError("");
        setAvailabilityPrompt(pickupAt && returnAt
          ? `${data.length} vehicle${data.length === 1 ? "" : "s"} available for the selected dates.`
          : "");
      })
      .catch((e) => { setError(errorMessage(e)); setAvailabilityPrompt(""); })
      .finally(() => setLoading(false));
  }, [filters]);
  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value, ...(key === "cityId" ? { locationId: "" } : {}) }));
  }
  function toggleCompare(vehicle) {
    setComparison((current) => current.some((item) => item.id === vehicle.id)
      ? current.filter((item) => item.id !== vehicle.id)
      : current.length < 3 ? [...current, vehicle] : current);
  }
  function clearFilters() {
    setFilters({ q: "", cityId: "", locationId: "", category: "", fuelType: "", transmission: "", minSeats: "", maxRate: "", pickupAt: "", returnAt: "", sort: "price-asc" });
    setComparison([]);
  }
  return <main className="page-wrap">
    <div className="page-heading"><div><p className="eyebrow">FIND YOUR RIDE</p><h1>Vehicles for every kind of trip.</h1></div>
      <p className="muted">Sample inventory and candidate pickup areas for demonstration—not verified rental branches.</p></div>
    <div className="filters panel">
      <label className="filter-search">Search vehicle<input value={filters.q} placeholder="Brand, model or name" onChange={(e) => updateFilter("q", e.target.value)} /></label>
      <label>City / service area<select value={filters.cityId} onChange={(e) => updateFilter("cityId", e.target.value)}><option value="">All cities</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></label>
      <label>Pickup area<select value={filters.locationId} onChange={(e) => updateFilter("locationId", e.target.value)}><option value="">All pickup areas</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.cityName}</option>)}</select></label>
      <label>Pickup date and time<input type="datetime-local" value={filters.pickupAt} onChange={(e) => updateFilter("pickupAt", e.target.value)} /></label>
      <label>Return date and time<input type="datetime-local" min={filters.pickupAt || undefined} value={filters.returnAt} onChange={(e) => updateFilter("returnAt", e.target.value)} /></label>
      <label>Category<select value={filters.category} onChange={(e) => updateFilter("category", e.target.value)}><option value="">All categories</option><option value="FOUR_WHEELER">Cars</option><option value="TWO_WHEELER">Two-wheelers</option><option value="COMMERCIAL">Commercial</option></select></label>
      <label>Fuel type<select value={filters.fuelType} onChange={(e) => updateFilter("fuelType", e.target.value)}><option value="">All fuel types</option>{["PETROL","DIESEL","HYBRID","ELECTRIC"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Transmission<select value={filters.transmission} onChange={(e) => updateFilter("transmission", e.target.value)}><option value="">Any transmission</option><option value="MANUAL">Manual</option><option value="AUTOMATIC">Automatic</option></select></label>
      <label>Minimum seats<input type="number" min="1" max="20" placeholder="Any" value={filters.minSeats} onChange={(e) => updateFilter("minSeats", e.target.value)} /></label>
      <label>Maximum base price / day<input type="number" min="0" placeholder="Any price" value={filters.maxRate} onChange={(e) => updateFilter("maxRate", e.target.value)} /></label>
      <label>Sort by<select value={filters.sort} onChange={(e) => updateFilter("sort", e.target.value)}><option value="price-asc">Lowest price</option><option value="price-desc">Highest price</option><option value="rating">Rating</option></select></label>
      <p className="availability-hint">Choose both dates to hide vehicles already booked or in maintenance for that period.</p>
      <button className="button-quiet clear-filters" onClick={clearFilters}>Clear filters</button>
    </div>
    <div className="results-toolbar"><div><strong>{vehicles.length} {filters.pickupAt && filters.returnAt ? "available" : "matching"} vehicle{vehicles.length === 1 ? "" : "s"}</strong>
      <span>{comparison.length} / 3 selected to compare</span></div>
      {vehicles.length > 0 && <button className="button-quiet" type="button" aria-expanded={showVehicles} aria-controls="vehicle-results" onClick={() => setShowVehicles((visible) => !visible)}>
        {showVehicles ? "Hide vehicles" : "Show vehicles"}
      </button>}
    </div>
    {error && <p className="error">{error}</p>}
    {availabilityPrompt && <p className="availability-status" role="status">{availabilityPrompt}</p>}
    {loading && <div className="empty panel">Loading demonstration inventory…</div>}
    {!loading && !vehicles.length && !error && <div className="empty panel">No vehicles match. Try clearing one or more filters.</div>}
    {!loading && showVehicles && vehicles.length > 0 && <div className="vehicle-grid" id="vehicle-results">{vehicles.map((v) => <article className="vehicle-card" key={v.id}>
        <div className="vehicle-image"><img src={v.image_url} alt={`${v.brand} ${v.model}`} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "https://placehold.co/800x450?text=Demo+vehicle"; }} /><span>{v.subcategory}</span></div>
        <div className="vehicle-info"><h2>{v.name}</h2><strong>{money(v.base_daily_rate)}<small> / day</small></strong></div>
        <p className="vehicle-meta">{v.subcategory} · {v.pricingTierLabel || "Vehicle"}</p>
        <p className="vehicle-seats">{v.seating_capacity} seats</p>
        <div className="vehicle-actions"><button className="button-quiet" onClick={() => toggleCompare(v)} disabled={!comparison.some((item) => item.id === v.id) && comparison.length >= 3}>{comparison.some((item) => item.id === v.id) ? "Remove compare" : "Compare"}</button><button className="button-quiet" onClick={() => setDetails(v)}>Details</button></div>
        <Link className="button button-dark" to={user ? `/book/${v.id}` : "/login"} state={!user ? { from: `/book/${v.id}` } : undefined}>
          Get pricing details <span>→</span>
        </Link>
      </article>)}</div>}
    {comparison.length > 0 && <section className="panel compare-panel"><div className="section-title"><h2>Compare vehicles</h2><button className="button-quiet" onClick={() => setComparison([])}>Clear comparison</button></div>
      <div className="compare-grid">{comparison.map((vehicle) => <article key={vehicle.id}><h3>{vehicle.name}</h3><p>{vehicle.subcategory} · {vehicle.pricingTierLabel || "Vehicle"}</p><p>{vehicle.seating_capacity} seats</p><strong>{money(vehicle.base_daily_rate)} / day</strong></article>)}</div>
    </section>}
    {details && <div className="modal-backdrop" role="presentation" onClick={() => setDetails(null)}><section className="panel vehicle-modal" role="dialog" aria-modal="true" aria-labelledby="vehicle-detail-title" onClick={(event) => event.stopPropagation()}>
      <button className="button-quiet modal-close" onClick={() => setDetails(null)}>Close</button><img src={details.image_url} alt="" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "https://placehold.co/800x450?text=Demo+vehicle"; }} />
      <p className="eyebrow">{details.pricingTierLabel || "Vehicle"} · DEMO LISTING</p><h2 id="vehicle-detail-title">{details.name}</h2>
      <p>{details.subcategory}</p><p>{details.seating_capacity} seats</p>
      <strong>{money(details.base_daily_rate)} per day · final price depends on dates and demand</strong>
      <Link className="button button-dark" to={user ? `/book/${details.id}` : "/login"} state={!user ? { from: `/book/${details.id}` } : undefined}>
        Get pricing details
      </Link>
    </section></div>}
  </main>;
}

function Booking({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState(null);
  const [dates, setDates] = useState({ pickupAt: "", returnAt: "" });
  const [quote, setQuote] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentSimulation, setPaymentSimulation] = useState("success");
  useEffect(() => { api.get(`/vehicles/${id}`).then(({ data }) => setVehicle(data)).catch((e) => setError(errorMessage(e))); }, [id]);
  if (!user) return <Navigate to="/login" replace />;
  async function requestQuote(event) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    try {
      const { data } = await api.post("/pricing/quote", {
        vehicleId: id,
        pickupAt: new Date(dates.pickupAt).toISOString(),
        returnAt: new Date(dates.returnAt).toISOString()
      });
      setQuote(data.quote);
    } catch (e) { setError(errorMessage(e)); setQuote(null); } finally { setBusy(false); }
  }
  async function book() {
    setError(""); setBusy(true);
    try {
      const booking = await createBooking(quote.id);
      const payment = await payMockBooking(booking.id, paymentSimulation);
      setMessage(`Payment ${payment.paymentStatus.toLowerCase()}. Your booking is ${payment.bookingStatus.toLowerCase()}.`);
      if (payment.paymentStatus === "PAID") {
        setQuote(null);
        navigate(`/bookings/${booking.id}`);
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <main className="page-wrap booking-layout">
    <section><p className="eyebrow">YOUR BOOKING</p><h1>{vehicle?.name || "Loading vehicle…"}</h1>
      {vehicle && <div className="panel booking-vehicle"><p>{vehicle.brand} {vehicle.model} · {vehicle.location_name}, {vehicle.city}</p><p>{vehicle.description}</p><p>Base rate {money(vehicle.base_daily_rate)} per day</p></div>}
      <form className="panel booking-form" onSubmit={requestQuote}><h2>Select rental dates</h2>
        <label>Pickup date and time<input required type="datetime-local" value={dates.pickupAt} onChange={(e) => setDates({ ...dates, pickupAt: e.target.value })} /></label>
        <label>Return date and time<input required type="datetime-local" value={dates.returnAt} onChange={(e) => setDates({ ...dates, returnAt: e.target.value })} /></label>
        <button disabled={busy}>{busy ? "Checking…" : "Check availability & price"}</button>
      </form>
    </section>
    <aside className="panel quote-panel"><p className="eyebrow">PRICE ESTIMATE</p><h2>Transparent pricing</h2>
      {!quote && <p className="muted">Choose your dates to get an availability check and current price.</p>}
      {quote && <><div className="quote-lines"><div><span>Base price · {quote.breakdown.rateUnit === "hour" ? `${quote.breakdown.rentalHours} hour(s)` : `${quote.breakdown.rentalDays} day(s)`}</span><b>{money(quote.breakdown.baseTotal, quote.currency)}</b></div>
        <div><span>Demand adjustment</span><b>{money(quote.breakdown.demandAdjustment, quote.currency)}</b></div>
        <div><span>Availability adjustment</span><b>{money(quote.breakdown.availabilityAdjustment, quote.currency)}</b></div>
        <div><span>Peak dates adjustment</span><b>{money(quote.breakdown.peakAdjustment, quote.currency)}</b></div>
        <div><span>Price floor / ceiling adjustment</span><b>{money(quote.breakdown.priceLimitAdjustment, quote.currency)}</b></div>
        <div><span>Duration discount</span><b>{money(quote.breakdown.durationAdjustment, quote.currency)}</b></div>
        <div><span>Early-booking discount</span><b>{money(-quote.breakdown.earlyBookingAdjustment, quote.currency)}</b></div>
        <div><span>Booking fee</span><b>{money(quote.breakdown.feeAmount, quote.currency)}</b></div>
        <div><span>Taxes · {quote.breakdown.taxPercent}%</span><b>{money(quote.breakdown.taxAmount, quote.currency)}</b></div>
        <div><span>Demand · {quote.breakdown.demandLevel}</span><b>×{quote.breakdown.demandMultiplier}</b></div>
        <div><span>Comparable availability</span><b>{quote.breakdown.availableComparableVehicles}/{quote.breakdown.comparableVehicleCount} · ×{quote.breakdown.availabilityMultiplier}</b></div>
      </div>{quote.breakdown.explanation?.map((line) => <p className="fine-print" key={line}>{line}</p>)}<div className="quote-total"><span>Total</span><strong>{money(quote.final_total, quote.currency)}</strong></div>
      <p className="fine-print">Quote expires {new Date(quote.expires_at).toLocaleString()}. Mock payment is used for this local demo.</p>
      <label className="payment-sim">Mock payment result<select value={paymentSimulation} onChange={(e) => setPaymentSimulation(e.target.value)}><option value="success">Simulate success</option><option value="failure">Simulate failure</option></select></label>
      <button disabled={busy} onClick={book}>{busy ? "Processing…" : "Confirm & mock-pay"}</button></>}
      {error && <p role="alert" className="error">{error}</p>}{message && <p className={message.includes("failed") ? "error" : "success"}>{message} <Link to="/bookings">View bookings</Link></p>}
    </aside>
  </main>;
}

function MyBookings() {
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { api.get("/bookings/my").then(({ data }) => setBookings(data)).catch((e) => setError(errorMessage(e))); }, [refresh]);
  async function cancel(id) {
    try { await api.post(`/bookings/${id}/cancel`); setRefresh((x) => x + 1); }
    catch (e) { setError(errorMessage(e)); }
  }
  return <main className="page-wrap"><p className="eyebrow">YOUR ACCOUNT</p><h1>My bookings</h1>{error && <p className="error">{error}</p>}
    {!bookings.length && !error && <div className="empty panel">You don't have any bookings yet. <Link to="/vehicles">Find your next ride</Link></div>}
    <div className="booking-list">{bookings.map((b) => <article className="panel booking-row" key={b.id}>
      <div><p className="eyebrow">{b.status} · PAYMENT {b.payment_status}</p><h2>{b.vehicle_name} {b.brand} {b.model}</h2>
        <p>{new Date(b.pickup_at).toLocaleString()} — {new Date(b.return_at).toLocaleString()}</p></div>
      <div className="booking-price"><strong>{money(b.total_price, b.currency)}</strong><Link className="button-quiet" to={`/bookings/${b.id}`}>Receipt</Link>{b.status === "CONFIRMED" && <button className="button-quiet" onClick={() => cancel(b.id)}>Cancel</button>}</div>
    </article>)}</div>
  </main>;
}

function BookingReceipt() {
  const { id } = useParams();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getBooking(id).then(setRecord).catch((e) => setError(errorMessage(e)));
  }, [id]);
  if (error) return <main className="page-wrap"><p className="error">{error}</p></main>;
  if (!record) return <main className="page-wrap"><p>Loading booking receipt…</p></main>;
  const { booking, priceSnapshot, payment } = record;
  return <main className="page-wrap receipt-page">
    <article className="panel receipt-card">
      <div className="receipt-actions"><button onClick={() => window.print()}>Print receipt</button><Link className="button-quiet" to="/bookings">My bookings</Link></div>
      <p className="eyebrow">ROAM · DEMONSTRATION RECEIPT</p><h1>Booking confirmed</h1>
      <p className="muted">This is a local demo booking and simulated payment, not a real rental confirmation.</p>
      <div className="receipt-meta"><div><span>Booking reference</span><strong>{booking.id}</strong></div><div><span>Status</span><strong>{booking.status} · {payment?.status || "UNPAID"}</strong></div>
        <div><span>Vehicle</span><strong>{booking.vehicle_brand} {booking.vehicle_model} · {booking.vehicle_name}</strong></div>
        <div><span>Pickup location</span><strong>{booking.location_name}, {booking.city_name}</strong></div>
        <div><span>Rental period</span><strong>{new Date(booking.pickupAt).toLocaleString()} — {new Date(booking.returnAt).toLocaleString()}</strong></div>
      </div>
      <h2>Agreed price snapshot</h2><div className="quote-lines">
        <div><span>Base rental</span><b>{money(priceSnapshot.baseRentalAmount, booking.currency)}</b></div>
        <div><span>Demand adjustment</span><b>{money(priceSnapshot.demandAdjustment, booking.currency)}</b></div>
        <div><span>Availability adjustment</span><b>{money(priceSnapshot.availabilityAdjustment, booking.currency)}</b></div>
        <div><span>Peak adjustment</span><b>{money(priceSnapshot.peakAdjustment, booking.currency)}</b></div>
        <div><span>Price limit adjustment</span><b>{money(priceSnapshot.priceLimitAdjustment, booking.currency)}</b></div>
        <div><span>Duration discount</span><b>{money(priceSnapshot.durationAdjustment, booking.currency)}</b></div>
        <div><span>Early-booking discount</span><b>{money(-priceSnapshot.earlyBookingAdjustment, booking.currency)}</b></div>
        <div><span>Booking fee and tax</span><b>{money(priceSnapshot.feeAmount + priceSnapshot.taxAmount, booking.currency)}</b></div>
      </div>
      <div className="quote-total"><span>Agreed total</span><strong>{money(booking.total_price, booking.currency)}</strong></div>
      <p className="fine-print">Payment provider: {payment?.provider || "MOCK"} · Transaction: {payment?.transactionRef || "not available"} · Rule version: {priceSnapshot.ruleVersion}</p>
    </article>
  </main>;
}

function PricingSimulator() {
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({
    vehicleId: "", pickupAt: "", returnAt: "", recentBookings: 4, expectedBookings: 4,
    availableVehicles: 8, comparableVehicles: 10, peakEnabled: false,
    baseDailyRate: "", minimumDailyRate: "", maximumDailyRate: "",
    durationDiscountPercent: "", earlyBookingDiscountPercent: "", bookingFee: "", taxPercent: ""
  });
  const [result, setResult] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const selected = vehicles.find((vehicle) => vehicle.id === form.vehicleId);
  useEffect(() => {
    api.get("/vehicles").then(({ data }) => {
      setVehicles(data);
      if (data.length) {
        const start = new Date(Date.now() + 21 * 86400000);
        const end = new Date(start.getTime() + 4 * 86400000);
        const localValue = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        setForm((current) => ({
          ...current, vehicleId: current.vehicleId || data[0].id,
          pickupAt: current.pickupAt || localValue(start), returnAt: current.returnAt || localValue(end),
          baseDailyRate: current.baseDailyRate || data[0].base_daily_rate,
          minimumDailyRate: current.minimumDailyRate || data[0].min_daily_rate,
          maximumDailyRate: current.maximumDailyRate || data[0].max_daily_rate
        }));
      }
    }).catch((e) => setError(errorMessage(e)));
  }, []);
  function setValue(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }
  async function runSimulation(input = form, options = {}) {
    const vehicle = vehicles.find((item) => item.id === input.vehicleId);
    if (!vehicle || !input.pickupAt || !input.returnAt) return null;
    const overrides = {
      baseDailyRate: Number(input.baseDailyRate || vehicle.base_daily_rate),
      minimumDailyRate: Number(input.minimumDailyRate || vehicle.min_daily_rate),
      maximumDailyRate: Number(input.maximumDailyRate || vehicle.max_daily_rate),
      durationDiscountPercent: Number(input.durationDiscountPercent || 0),
      earlyBookingDiscountPercent: Number(input.earlyBookingDiscountPercent || 0),
      bookingFee: Number(input.bookingFee || 0),
      taxPercent: Number(input.taxPercent || 0)
    };
    const response = await simulatePrice({
      vehicleId: input.vehicleId,
      pickupAt: new Date(input.pickupAt).toISOString(),
      returnAt: new Date(input.returnAt).toISOString(),
      recentBookings: Number(input.recentBookings),
      expectedBookings: Number(input.expectedBookings),
      availableVehicles: Number(input.availableVehicles),
      comparableVehicles: Number(input.comparableVehicles),
      peakEnabled: Boolean(input.peakEnabled),
      overrides,
      ...options
    });
    return response;
  }
  useEffect(() => {
    if (!form.vehicleId || !form.pickupAt || !form.returnAt) return undefined;
    const timer = setTimeout(async () => {
      setLoading(true);
      try { setResult(await runSimulation()); setError(""); }
      catch (e) { setError(errorMessage(e)); setResult(null); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [form, vehicles]);
  async function compareScenarios() {
    if (!selected) return;
    const base = { ...form, vehicleId: selected.id, peakEnabled: false };
    const cases = [
      ["Normal demand", { recentBookings: 4, expectedBookings: 4, availableVehicles: 8, peakEnabled: false }],
      ["High demand", { recentBookings: 8, expectedBookings: 4, availableVehicles: 8, peakEnabled: false }],
      ["Low availability", { recentBookings: 4, expectedBookings: 4, availableVehicles: 1, peakEnabled: false }],
      ["Peak period", { recentBookings: 4, expectedBookings: 4, availableVehicles: 8, peakEnabled: true }],
      ["Long duration", { recentBookings: 4, expectedBookings: 4, availableVehicles: 8, returnAt: new Date(new Date(form.pickupAt).getTime() + 7 * 86400000).toISOString().slice(0, 16) }],
      ["Price ceiling", { recentBookings: 8, expectedBookings: 4, availableVehicles: 1, peakEnabled: true, baseDailyRate: selected.max_daily_rate * 2 }]
    ];
    try {
      const rows = await Promise.all(cases.map(async ([name, override]) => {
        const scenario = { ...base, ...override };
        const response = await runSimulation(scenario, {
          overrides: {
            baseDailyRate: Number(scenario.baseDailyRate || selected.base_daily_rate),
            minimumDailyRate: Number(scenario.minimumDailyRate || selected.min_daily_rate),
            maximumDailyRate: Number(scenario.maximumDailyRate || selected.max_daily_rate),
            durationDiscountPercent: Number(scenario.durationDiscountPercent || 0),
            earlyBookingDiscountPercent: Number(scenario.earlyBookingDiscountPercent || 0),
            bookingFee: Number(scenario.bookingFee || 0),
            taxPercent: Number(scenario.taxPercent || 0)
          }
        });
        return { name, total: response.quote.total, change: response.percentChangeFromBase };
      }));
      setScenarios(rows);
    } catch (e) { setError(errorMessage(e)); }
  }
  function reset() {
    if (!selected) return;
    setScenarios([]);
    setForm((current) => ({
      ...current, recentBookings: 4, expectedBookings: 4,
      availableVehicles: 8, comparableVehicles: 10, peakEnabled: false,
      baseDailyRate: selected.base_daily_rate, minimumDailyRate: selected.min_daily_rate,
      maximumDailyRate: selected.max_daily_rate, durationDiscountPercent: 10,
      earlyBookingDiscountPercent: 0, bookingFee: 0, taxPercent: 0
    }));
  }
  return <main className="page-wrap simulator-page">
    <div className="page-heading"><div><p className="eyebrow">DEMO / SIMULATION MODE</p><h1>Pricing simulator</h1></div><p className="muted">Test rule scenarios; simulation never changes a customer quote or booking.</p></div>
    <div className="simulator-layout"><section className="panel">
      <p className="eyebrow">SIMULATION INPUTS</p><h2>Set the market conditions</h2>
      <div className="admin-form">
        <label className="full">Vehicle<select value={form.vehicleId} onChange={(e) => {
          const item = vehicles.find((vehicle) => vehicle.id === e.target.value);
          setForm((current) => ({ ...current, vehicleId: e.target.value, baseDailyRate: item?.base_daily_rate || "", minimumDailyRate: item?.min_daily_rate || "", maximumDailyRate: item?.max_daily_rate || "" }));
        }}>{vehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicle.brand} {vehicle.model} · {vehicle.city}</option>)}</select></label>
        <label>Pickup<input type="datetime-local" value={form.pickupAt} onChange={(e) => setValue("pickupAt", e.target.value)} /></label>
        <label>Return<input type="datetime-local" value={form.returnAt} onChange={(e) => setValue("returnAt", e.target.value)} /></label>
        <label>Recent bookings · last 7 days<input type="number" min="0" value={form.recentBookings} onChange={(e) => setValue("recentBookings", Number(e.target.value))} /></label>
        <label>Expected bookings baseline<input type="number" min="1" value={form.expectedBookings} onChange={(e) => setValue("expectedBookings", Number(e.target.value))} /></label>
        <label>Available comparable vehicles<input type="number" min="0" value={form.availableVehicles} onChange={(e) => setValue("availableVehicles", Number(e.target.value))} /></label>
        <label>Comparable fleet size<input type="number" min="1" value={form.comparableVehicles} onChange={(e) => setValue("comparableVehicles", Number(e.target.value))} /></label>
        <label>Base daily rate<input type="number" min="1" value={form.baseDailyRate} onChange={(e) => setValue("baseDailyRate", Number(e.target.value))} /></label>
        <label>Minimum daily rate<input type="number" min="0" value={form.minimumDailyRate} onChange={(e) => setValue("minimumDailyRate", Number(e.target.value))} /></label>
        <label>Maximum daily rate<input type="number" min="1" value={form.maximumDailyRate} onChange={(e) => setValue("maximumDailyRate", Number(e.target.value))} /></label>
        <label>Long-rental discount %<input type="number" min="0" max="100" value={form.durationDiscountPercent} onChange={(e) => setValue("durationDiscountPercent", Number(e.target.value))} /></label>
        <label>Early-booking discount %<input type="number" min="0" max="100" value={form.earlyBookingDiscountPercent} onChange={(e) => setValue("earlyBookingDiscountPercent", Number(e.target.value))} /></label>
        <label>Booking fee<input type="number" min="0" value={form.bookingFee} onChange={(e) => setValue("bookingFee", Number(e.target.value))} /></label>
        <label>Tax %<input type="number" min="0" max="100" value={form.taxPercent} onChange={(e) => setValue("taxPercent", Number(e.target.value))} /></label>
        <label className="check-label"><input type="checkbox" checked={form.peakEnabled} onChange={(e) => setValue("peakEnabled", e.target.checked)} />Apply peak pricing</label>
      </div>
      <div className="simulator-actions"><button onClick={compareScenarios}>Compare six scenarios</button><button className="button-quiet" onClick={reset}>Reset simulation</button></div>
    </section>
    <aside className="panel sim-result"><p className="eyebrow">LIVE CALCULATION · {loading ? "UPDATING" : "DEMO"}</p><h2>{selected ? `${selected.name} · ${selected.city}` : "Choose a vehicle"}</h2>
      {error && <p className="error">{error}</p>}
      {result && <><div className="sim-score-row"><span>Demand score <b>{result.quote.demandScore ?? "—"}</b> · {result.demandLevel}</span><span>Availability <b>{Math.round((result.quote.availabilityRatio ?? 0) * 100)}%</b> · {result.availabilityLevel}</span></div>
        <div className="quote-lines">
          <div><span>Base rental amount</span><b>{money(result.quote.baseRentalAmount)}</b></div>
          <div><span>Demand contribution · ×{result.quote.demandMultiplier}</span><b>{money(result.quote.demandAdjustment)}</b></div>
          <div><span>Availability contribution · ×{result.quote.availabilityMultiplier}</span><b>{money(result.quote.availabilityAdjustment)}</b></div>
          <div><span>Peak contribution · ×{result.quote.peakMultiplier}</span><b>{money(result.quote.peakAdjustment)}</b></div>
          <div><span>Rate floor / ceiling effect</span><b>{money(result.quote.priceLimitAdjustment)}</b></div>
          <div><span>Duration discount</span><b>{money(result.quote.durationAdjustment)}</b></div>
          <div><span>Early booking discount</span><b>{money(-result.quote.earlyBookingAdjustment)}</b></div>
          <div><span>Fees</span><b>{money(result.quote.feeAmount)}</b></div>
          <div><span>Tax · {result.quote.taxPercent}%</span><b>{money(result.quote.taxAmount)}</b></div>
        </div><div className="quote-total"><span>Simulated total · {result.percentChangeFromBase}% vs base</span><strong>{money(result.quote.total)}</strong></div>
        <ul className="explanation-list">{result.quote.explanation.map((line) => <li key={line}>{line}</li>)}</ul>
      </>}
    </aside></div>
    <section className="panel scenario-panel"><div className="section-title"><h2>Scenario comparison</h2><span className="eyebrow">ILLUSTRATIVE ONLY</span></div>
      {!scenarios.length ? <p className="muted">Run the six scenarios to compare normal demand, high demand, scarce supply, peak dates, long duration, and a price ceiling case.</p> :
      <div className="scenario-grid">{scenarios.map((scenario) => <article key={scenario.name}><span>{scenario.name}</span><strong>{money(scenario.total)}</strong><small>{scenario.change}% vs base</small></article>)}</div>}
    </section>
  </main>;
}

function Admin() {
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [settings, setSettings] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [types, setTypes] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [peaks, setPeaks] = useState([]);
  const [maintenancePeriods, setMaintenancePeriods] = useState([]);
  const [priceHistory, setPriceHistory] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [vehicleForm, setVehicleForm] = useState({ name: "", brand: "", model: "", typeId: "", locationId: "", baseDailyRate: "", baseHourlyRate: "", minDailyRate: "", maxDailyRate: "", description: "" });
  const [peakForm, setPeakForm] = useState({ name: "", startsAt: "", endsAt: "", cityId: "", locationId: "", multiplier: 1.1 });
  const [maintenanceForm, setMaintenanceForm] = useState({ vehicleId: "", startsAt: "", endsAt: "", reason: "" });
  const [discount, setDiscount] = useState("");
  const [taxPercent, setTaxPercent] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    Promise.all([
      api.get("/admin/dashboard"), api.get("/admin/pricing-settings"), api.get("/vehicles"),
      api.get("/locations"), api.get("/vehicle-types"), api.get("/admin/bookings"), api.get("/admin/peak-dates"),
      api.get("/admin/maintenance-periods"), api.get("/admin/price-history"), api.get("/admin/audit-logs"),
      getAdminAnalytics(), api.get("/cities")
    ]).then(([a,b,c,d,e,f,g,h,i,j,k,l]) => {
      setStats(a.data); setSettings(b.data); setDiscount(b.data.duration_discount_percent); setTaxPercent(b.data.tax_percent);
      setVehicles(c.data); setLocations(d.data); setTypes(e.data); setBookings(f.data); setPeaks(g.data);
      setMaintenancePeriods(h.data); setPriceHistory(i.data); setAuditLogs(j.data); setAnalytics(k); setCities(l.data);
      setVehicleForm((form) => ({ ...form, typeId: form.typeId || e.data[0]?.id || "", locationId: form.locationId || d.data[0]?.id || "" }));
      setMaintenanceForm((form) => ({ ...form, vehicleId: form.vehicleId || c.data[0]?.id || "" }));
      setError("");
    }).catch((e) => setError(errorMessage(e)));
  }, [refresh]);
  async function createVehicle(event) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      const body = { ...vehicleForm, baseDailyRate: Number(vehicleForm.baseDailyRate), baseHourlyRate: Number(vehicleForm.baseHourlyRate), minDailyRate: Number(vehicleForm.minDailyRate), maxDailyRate: Number(vehicleForm.maxDailyRate) };
      await api.post("/admin/vehicles", body); setNotice("Vehicle added."); setRefresh((x) => x + 1);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function savePricing(event) {
    event.preventDefault();
    try {
      await api.patch("/admin/pricing-settings", {
        durationDiscountPercent: Number(discount),
        taxPercent: Number(taxPercent),
        earlyBookingDiscountPercent: Number(settings.early_booking_discount_percent),
        earlyBookingMinimumDays: Number(settings.early_booking_minimum_days),
        bookingFee: Number(settings.booking_fee),
        lowDemandMultiplier: Number(settings.low_demand_multiplier),
        highDemandMultiplier: Number(settings.high_demand_multiplier),
        demandLowScore: Number(settings.demand_low_score),
        demandNormalScore: Number(settings.demand_normal_score),
        demandElevatedScore: Number(settings.demand_elevated_score),
        normalDemandMultiplier: Number(settings.normal_demand_multiplier),
        demandElevatedMultiplier: Number(settings.demand_elevated_multiplier),
        lowAvailabilityMultiplier: Number(settings.low_availability_multiplier),
        peakMultiplier: Number(settings.peak_multiplier),
        availabilityLowRatio: Number(settings.availability_low_ratio),
        availabilityMediumRatio: Number(settings.availability_medium_ratio),
        availabilityMediumMultiplier: Number(settings.availability_medium_multiplier)
      });
      setNotice("Pricing settings updated."); setRefresh((x) => x + 1);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function createPeak(event) {
    event.preventDefault();
    try {
      await api.post("/admin/peak-dates", {
        ...peakForm,
        startsAt: new Date(peakForm.startsAt).toISOString(),
        endsAt: new Date(peakForm.endsAt).toISOString(),
        multiplier: Number(peakForm.multiplier),
        locationId: peakForm.locationId || undefined,
        cityId: peakForm.cityId || undefined
      });
      setPeakForm({ name: "", startsAt: "", endsAt: "", cityId: "", locationId: "", multiplier: 1.1 });
      setNotice("Peak period added."); setRefresh((x) => x + 1);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function deactivatePeak(id) {
    try { await api.delete(`/admin/peak-dates/${id}`); setRefresh((x) => x + 1); }
    catch (e) { setError(errorMessage(e)); }
  }
  async function changeVehicleStatus(vehicle, status) {
    try { await api.patch(`/admin/vehicles/${vehicle.id}`, { status }); setRefresh((x) => x + 1); }
    catch (e) { setError(errorMessage(e)); }
  }
  async function saveVehicle(event) {
    event.preventDefault();
    try {
      const body = {
        ...editingVehicle,
        baseDailyRate: Number(editingVehicle.baseDailyRate),
        baseHourlyRate: Number(editingVehicle.baseHourlyRate),
        minDailyRate: Number(editingVehicle.minDailyRate),
        maxDailyRate: Number(editingVehicle.maxDailyRate)
      };
      delete body.id;
      delete body.type;
      delete body.locationId;
      delete body.locationName;
      delete body.vehicle_type;
      delete body.location_id;
      delete body.location_name;
      delete body.base_daily_rate;
      delete body.base_hourly_rate;
      delete body.min_daily_rate;
      delete body.max_daily_rate;
      delete body.image_url;
      delete body.createdAt;
      await api.patch(`/admin/vehicles/${editingVehicle.id}`, body);
      setEditingVehicle(null); setNotice("Vehicle updated."); setRefresh((x) => x + 1);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function createMaintenance(event) {
    event.preventDefault();
    try {
      await api.post("/admin/maintenance-periods", {
        vehicleId: maintenanceForm.vehicleId,
        startsAt: new Date(maintenanceForm.startsAt).toISOString(),
        endsAt: new Date(maintenanceForm.endsAt).toISOString(),
        reason: maintenanceForm.reason
      });
      setNotice("Maintenance period added."); setRefresh((x) => x + 1);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function deleteMaintenance(id) {
    try { await api.delete(`/admin/maintenance-periods/${id}`); setRefresh((x) => x + 1); }
    catch (e) { setError(errorMessage(e)); }
  }
  async function updateBookingStatus(id, status) {
    try { await api.patch(`/admin/bookings/${id}/status`, { status }); setRefresh((x) => x + 1); }
    catch (e) { setError(errorMessage(e)); }
  }
  return <main className="page-wrap admin-page"><div className="page-heading"><div><p className="eyebrow">OPERATIONS</p><h1>Admin dashboard</h1></div><p className="muted">Manage fleet and pricing rules.</p></div>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p className="success">{notice}</p>}
    <div className="stats-grid">{[
      ["Active vehicles", stats?.active_vehicles], ["Confirmed bookings", stats?.confirmed_bookings],
      ["Paid revenue", money(stats?.paid_revenue)], ["Fleet utilization · 7 days", `${analytics?.utilization_rate ?? "—"}%`],
      ["Cancellation rate", `${stats?.cancellation_rate ?? "—"}%`], ["Demo inventory", stats?.sample_vehicles],
      ["Pickup areas", stats?.configured_locations], ["Mock reservations", stats?.mock_reservations],
      ["Unavailable sample vehicles", stats?.unavailable_vehicles]
    ].map(([label, value]) => <div className="stat-card" key={label}><p>{label}</p><strong>{value ?? "—"}</strong></div>)}</div>
    <div className="admin-grid">
      <section className="panel"><p className="eyebrow">PRICING CONTROLS</p><h2>Dynamic pricing rules</h2>
        {settings && <><form className="admin-form" onSubmit={savePricing}>
          <label>Long rental discount %<input type="number" min="0" max="50" step="0.5" value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
          <label>Tax %<input type="number" min="0" max="30" step="0.1" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} /></label>
          <label>Early-booking discount %<input type="number" min="0" max="50" value={settings.early_booking_discount_percent} onChange={(e) => setSettings({ ...settings, early_booking_discount_percent: e.target.value })} /></label>
          <label>Early-booking lead days<input type="number" min="0" value={settings.early_booking_minimum_days} onChange={(e) => setSettings({ ...settings, early_booking_minimum_days: e.target.value })} /></label>
          <label>Booking fee<input type="number" min="0" value={settings.booking_fee} onChange={(e) => setSettings({ ...settings, booking_fee: e.target.value })} /></label>
          <label>Low demand score threshold<input type="number" min="0" value={settings.demand_low_score} onChange={(e) => setSettings({ ...settings, demand_low_score: e.target.value })} /></label>
          <label>Normal demand score threshold<input type="number" min="0" value={settings.demand_normal_score} onChange={(e) => setSettings({ ...settings, demand_normal_score: e.target.value })} /></label>
          <label>Low-demand multiplier<input type="number" min="0.5" max="1.5" step="0.01" value={settings.low_demand_multiplier} onChange={(e) => setSettings({ ...settings, low_demand_multiplier: e.target.value })} /></label>
          <label>Normal-demand multiplier<input type="number" min="0.5" max="2" step="0.01" value={settings.normal_demand_multiplier} onChange={(e) => setSettings({ ...settings, normal_demand_multiplier: e.target.value })} /></label>
          <label>Elevated demand score threshold<input type="number" min="1" value={settings.demand_elevated_score} onChange={(e) => setSettings({ ...settings, demand_elevated_score: e.target.value })} /></label>
          <label>Elevated-demand multiplier<input type="number" min="0.5" max="2" step="0.01" value={settings.demand_elevated_multiplier} onChange={(e) => setSettings({ ...settings, demand_elevated_multiplier: e.target.value })} /></label>
          <label>High-demand multiplier<input type="number" min="0.5" max="2" step="0.01" value={settings.high_demand_multiplier} onChange={(e) => setSettings({ ...settings, high_demand_multiplier: e.target.value })} /></label>
          <label>Low availability ratio threshold<input type="number" min="0" max="1" step="0.01" value={settings.availability_low_ratio} onChange={(e) => setSettings({ ...settings, availability_low_ratio: e.target.value })} /></label>
          <label>Medium availability ratio threshold<input type="number" min="0" max="1" step="0.01" value={settings.availability_medium_ratio} onChange={(e) => setSettings({ ...settings, availability_medium_ratio: e.target.value })} /></label>
          <label>Low-availability multiplier<input type="number" min="0.5" max="2" step="0.01" value={settings.low_availability_multiplier} onChange={(e) => setSettings({ ...settings, low_availability_multiplier: e.target.value })} /></label>
          <label>Medium-availability multiplier<input type="number" min="0.5" max="2" step="0.01" value={settings.availability_medium_multiplier} onChange={(e) => setSettings({ ...settings, availability_medium_multiplier: e.target.value })} /></label>
          <label>Peak period multiplier<input type="number" min="0.5" max="2" step="0.01" value={settings.peak_multiplier} onChange={(e) => setSettings({ ...settings, peak_multiplier: e.target.value })} /></label>
          <button>Save pricing rules</button>
        </form></>}
      </section>
      <section className="panel"><p className="eyebrow">CALENDAR</p><h2>Peak date periods</h2>
        <form className="admin-form" onSubmit={createPeak}>
          <label>Period name<input required value={peakForm.name} onChange={(e) => setPeakForm({ ...peakForm, name: e.target.value })} /></label>
          <label>Starts<input required type="datetime-local" value={peakForm.startsAt} onChange={(e) => setPeakForm({ ...peakForm, startsAt: e.target.value })} /></label>
          <label>Ends<input required type="datetime-local" value={peakForm.endsAt} onChange={(e) => setPeakForm({ ...peakForm, endsAt: e.target.value })} /></label>
          <label>City scope<select value={peakForm.cityId} onChange={(e) => setPeakForm({ ...peakForm, cityId: e.target.value, locationId: "" })}><option value="">All cities</option>{cities.map((city) => <option value={city.id} key={city.id}>{city.name}</option>)}</select></label>
          <label>Pickup location scope<select value={peakForm.locationId} onChange={(e) => setPeakForm({ ...peakForm, locationId: e.target.value })}><option value="">All locations in scope</option>{locations.filter((location) => !peakForm.cityId || location.cityId === peakForm.cityId).map((location) => <option key={location.id} value={location.id}>{location.name} · {location.cityName}</option>)}</select></label>
          <label>Peak multiplier<input type="number" min="0.5" max="2" step="0.01" value={peakForm.multiplier} onChange={(e) => setPeakForm({ ...peakForm, multiplier: e.target.value })} /></label>
          <button>Add peak dates</button>
        </form>
        <div className="compact-list">{peaks.map((p) => <div key={p.id}><span>{p.name}<small>{new Date(p.starts_at).toLocaleDateString()} — {new Date(p.ends_at).toLocaleDateString()}</small></span><button className="button-quiet" onClick={() => deactivatePeak(p.id)}>Deactivate</button></div>)}</div>
      </section>
    </div>
    <div className="admin-grid">
      <section className="panel"><p className="eyebrow">FLEET</p><h2>Add vehicle</h2>
        <form className="admin-form" onSubmit={createVehicle}>
          <label>Display name<input required value={vehicleForm.name} onChange={(e) => setVehicleForm({ ...vehicleForm, name: e.target.value })} /></label>
          <label>Brand<input required value={vehicleForm.brand} onChange={(e) => setVehicleForm({ ...vehicleForm, brand: e.target.value })} /></label>
          <label>Model<input required value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} /></label>
          <label>Type<select value={vehicleForm.typeId} onChange={(e) => setVehicleForm({ ...vehicleForm, typeId: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Location<select value={vehicleForm.locationId} onChange={(e) => setVehicleForm({ ...vehicleForm, locationId: e.target.value })}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label>Base daily rate<input required type="number" min="0.01" step="0.01" value={vehicleForm.baseDailyRate} onChange={(e) => setVehicleForm({ ...vehicleForm, baseDailyRate: e.target.value })} /></label>
          <label>Hourly rate<input required type="number" min="0.01" step="0.01" value={vehicleForm.baseHourlyRate} onChange={(e) => setVehicleForm({ ...vehicleForm, baseHourlyRate: e.target.value })} /></label>
          <label>Minimum daily rate<input required type="number" min="0" step="0.01" value={vehicleForm.minDailyRate} onChange={(e) => setVehicleForm({ ...vehicleForm, minDailyRate: e.target.value })} /></label>
          <label>Maximum daily rate<input required type="number" min="0.01" step="0.01" value={vehicleForm.maxDailyRate} onChange={(e) => setVehicleForm({ ...vehicleForm, maxDailyRate: e.target.value })} /></label>
          <label className="full">Description<textarea value={vehicleForm.description} onChange={(e) => setVehicleForm({ ...vehicleForm, description: e.target.value })} /></label>
          <button>Add to fleet</button>
        </form>
        {editingVehicle && <form className="admin-form edit-form" onSubmit={saveVehicle}>
          <h3 className="full">Edit {editingVehicle.name}</h3>
          <label>Name<input required value={editingVehicle.name} onChange={(e) => setEditingVehicle({ ...editingVehicle, name: e.target.value })} /></label>
          <label>Brand<input required value={editingVehicle.brand} onChange={(e) => setEditingVehicle({ ...editingVehicle, brand: e.target.value })} /></label>
          <label>Model<input required value={editingVehicle.model} onChange={(e) => setEditingVehicle({ ...editingVehicle, model: e.target.value })} /></label>
          <label>Daily base<input required type="number" min="0.01" step="0.01" value={editingVehicle.baseDailyRate} onChange={(e) => setEditingVehicle({ ...editingVehicle, baseDailyRate: e.target.value })} /></label>
          <label>Hourly base<input required type="number" min="0.01" step="0.01" value={editingVehicle.baseHourlyRate} onChange={(e) => setEditingVehicle({ ...editingVehicle, baseHourlyRate: e.target.value })} /></label>
          <label>Minimum daily<input required type="number" min="0" step="0.01" value={editingVehicle.minDailyRate} onChange={(e) => setEditingVehicle({ ...editingVehicle, minDailyRate: e.target.value })} /></label>
          <label>Maximum daily<input required type="number" min="0.01" step="0.01" value={editingVehicle.maxDailyRate} onChange={(e) => setEditingVehicle({ ...editingVehicle, maxDailyRate: e.target.value })} /></label>
          <label className="full">Description<textarea value={editingVehicle.description || ""} onChange={(e) => setEditingVehicle({ ...editingVehicle, description: e.target.value })} /></label>
          <button>Save vehicle</button><button type="button" className="button-quiet" onClick={() => setEditingVehicle(null)}>Close</button>
        </form>}
        <div className="compact-list">{vehicles.map((v) => <div key={v.id}><span>{v.name}<small>{v.vehicle_type} · {v.location_name} · {money(v.base_daily_rate)}/day</small></span><span className="row-actions"><button className="button-quiet" onClick={() => setEditingVehicle({
          id: v.id, name: v.name, brand: v.brand, model: v.model, baseDailyRate: v.base_daily_rate,
          baseHourlyRate: v.base_hourly_rate, minDailyRate: v.min_daily_rate, maxDailyRate: v.max_daily_rate,
          description: v.description
        })}>Edit</button><button className="button-quiet" onClick={() => changeVehicleStatus(v, "INACTIVE")}>Deactivate</button></span></div>)}</div>
      </section>
      <section className="panel"><p className="eyebrow">RESERVATIONS</p><h2>Recent bookings</h2>
        <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics?.daily_trends || []}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="bookings" fill="#d4f45b" radius={[4,4,0,0]} />
        </BarChart></ResponsiveContainer></div>
        <div className="compact-list">{bookings.slice(0, 10).map((b) => <div key={b.id}><span>{b.vehicle_name} · {b.customer_name}<small>{b.status} · {b.payment_status}</small></span><span className="row-actions"><b>{money(b.total_price,b.currency)}</b>{b.status === "CONFIRMED" && <><button className="button-quiet" onClick={() => updateBookingStatus(b.id,"COMPLETED")}>Complete</button><button className="button-quiet" onClick={() => updateBookingStatus(b.id,"CANCELLED")}>Cancel</button></>}</span></div>)}</div>
        <div className="compact-list"><strong>Demand by vehicle type · last 7 days</strong>{analytics?.demand_by_type.map((item) => <div key={item.type}><span>{item.type}</span><b>{item.bookings} bookings</b></div>)}</div>
        <div className="compact-list"><strong>Paid revenue by location</strong>{analytics?.revenue_by_location.map((item) => <div key={item.location}><span>{item.location}</span><b>{money(item.revenue)}</b></div>)}</div>
      </section>
    </div>
    <div className="admin-grid">
      <section className="panel"><p className="eyebrow">FLEET OPERATIONS</p><h2>Maintenance calendar</h2>
        <form className="admin-form" onSubmit={createMaintenance}>
          <label>Vehicle<select value={maintenanceForm.vehicleId} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, vehicleId: e.target.value })}>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          <label>Reason<input value={maintenanceForm.reason} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, reason: e.target.value })} /></label>
          <label>Starts<input required type="datetime-local" value={maintenanceForm.startsAt} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, startsAt: e.target.value })} /></label>
          <label>Ends<input required type="datetime-local" value={maintenanceForm.endsAt} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, endsAt: e.target.value })} /></label>
          <button>Add maintenance period</button>
        </form>
        <div className="compact-list">{maintenancePeriods.map((period) => <div key={period.id}><span>{period.vehicleName}<small>{new Date(period.startsAt).toLocaleString()} — {new Date(period.endsAt).toLocaleString()} {period.reason}</small></span><button className="button-quiet" onClick={() => deleteMaintenance(period.id)}>Remove</button></div>)}</div>
      </section>
      <section className="panel"><p className="eyebrow">TRANSPARENCY</p><h2>Recent price quotes</h2>
        <div className="compact-list">{priceHistory.slice(0, 8).map((quote) => <div key={quote.id}><span>{quote.vehicleName}<small>{new Date(quote.created_at).toLocaleString()} · demand ×{quote.breakdown.demandMultiplier}, peak ×{quote.breakdown.peakMultiplier}</small></span><b>{money(quote.final_total, quote.currency)}</b></div>)}</div>
        <h2 className="subheading">Audit activity</h2>
        <div className="compact-list">{auditLogs.slice(0, 8).map((entry) => <div key={entry.id}><span>{entry.action} {entry.entityType}<small>{entry.email || "System"} · {new Date(entry.createdAt).toLocaleString()}</small></span></div>)}</div>
      </section>
    </div>
    <p className="fine-print">Revenue is the sum of mock or provider payments marked PAID. The local demo uses simulated checkout only.</p>
  </main>;
}

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rental_user") || "null"); } catch { return null; }
  });
  const navigate = useNavigate();
  const login = (data) => {
    localStorage.setItem("rental_token", data.token);
    localStorage.setItem("rental_user", JSON.stringify(data.user));
    setUser(data.user);
  };
  const logout = () => {
    localStorage.removeItem("rental_token"); localStorage.removeItem("rental_user");
    setUser(null); navigate("/");
  };
  const AdminRoute = useMemo(() => user?.role === "ADMIN" ? <Admin /> : <Navigate to="/login" replace />, [user]);
  const AdminSimulatorRoute = useMemo(() => user?.role === "ADMIN" ? <PricingSimulator /> : <Navigate to="/login" replace />, [user]);
  return <><Header user={user} onLogout={logout} /><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<AuthPage mode="login" onLogin={login} />} />
    <Route path="/register" element={<AuthPage mode="register" onLogin={login} />} />
    <Route path="/vehicles" element={<VehicleList user={user} />} />
    <Route path="/book/:id" element={user ? <Booking user={user} /> : <Navigate to="/login" replace />} />
    <Route path="/bookings" element={user ? <MyBookings /> : <Navigate to="/login" replace />} />
    <Route path="/bookings/:id" element={user ? <BookingReceipt /> : <Navigate to="/login" replace />} />
    <Route path="/admin" element={AdminRoute} />
    <Route path="/admin/simulator" element={AdminSimulatorRoute} />
    <Route path="*" element={<main className="page-wrap"><h1>Page not found</h1><Link to="/">Go home</Link></main>} />
  </Routes><footer><span>roam.</span> Vehicle rental, made simple.</footer></>;
}
