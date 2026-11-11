import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { store, persist, newId, databaseType, createReservation, shutdownStore } from "./store.js";
import { availabilityForCounts, calculatePrice, demandForCounts } from "./pricing.js";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 5000);
const currency = process.env.CURRENCY || "INR";
const quoteMinutes = Number(process.env.QUOTE_EXPIRY_MINUTES || 15);
const holdMinutes = Number(process.env.BOOKING_HOLD_MINUTES || 10);
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 characters in backend/.env");
}

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 300 }));

function audit(userId, action, entityType, entityId = null, details = {}) {
  store.auditLogs.unshift({ id: newId(), userId, action, entityType, entityId, details, createdAt: new Date().toISOString() });
}
function tokenFor(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: "8h" });
}
function requireAuth(req, res, next) {
  const token = req.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    if (!store.users.some((user) => user.id === req.user.sub)) {
      return res.status(401).json({ error: "This session is no longer valid. Sign in again." });
    }
    return next();
  }
  catch { return res.status(401).json({ error: "Invalid or expired token" }); }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Administrator access required" });
  return next();
}
const admin = [requireAuth, requireAdmin];
const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72)
});
const rentalSchema = z.object({
  vehicleId: z.string().uuid(),
  pickupAt: z.string().datetime({ offset: true }),
  returnAt: z.string().datetime({ offset: true })
}).refine((value) => new Date(value.returnAt) > new Date(value.pickupAt), {
  message: "Return time must be after pickup time"
});

function vehiclePublic(vehicle) {
  const { registrationNumber: _registrationNumber, ...publicVehicle } = vehicle;
  return {
    ...publicVehicle,
    vehicle_type: vehicle.type,
    location_id: vehicle.locationId,
    location_name: vehicle.locationName,
    base_daily_rate: vehicle.baseDailyRate,
    base_hourly_rate: vehicle.baseHourlyRate,
    min_daily_rate: vehicle.minDailyRate,
    max_daily_rate: vehicle.maxDailyRate,
    image_url: vehicle.imageUrl,
    fuel_type: vehicle.fuelType,
    seating_capacity: vehicle.seatingCapacity,
    city_id: vehicle.cityId
  };
}
function isOverlap(startA, endA, startB, endB) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}
function hasConflict(vehicleId, pickupAt, returnAt, ignoreBookingId = null) {
  const now = Date.now();
  return store.bookings.some((booking) => booking.vehicleId === vehicleId &&
    booking.id !== ignoreBookingId &&
    (booking.status === "CONFIRMED" || (booking.status === "PENDING" && Date.parse(booking.holdExpiresAt) > now)) &&
    isOverlap(booking.pickupAt, booking.returnAt, pickupAt, returnAt));
}
function getFactors(vehicle, input) {
  if (!vehicle || vehicle.status !== "ACTIVE" || vehicle.maintenanceStatus !== "OK") {
    const error = new Error("Vehicle is unavailable or not found"); error.status = 404; throw error;
  }
  if (hasConflict(vehicle.id, input.pickupAt, input.returnAt)) {
    const error = new Error("Vehicle is not available for those dates"); error.status = 409; throw error;
  }
  if (store.maintenancePeriods.some((period) => period.vehicleId === vehicle.id &&
    isOverlap(period.startsAt, period.endsAt, input.pickupAt, input.returnAt))) {
    const error = new Error("Vehicle has a maintenance block during the selected period"); error.status = 409; throw error;
  }

  const pricing = store.pricing;
  const metric = store.demandMetrics.find((item) => item.cityId === vehicle.cityId && item.category === vehicle.type);
  const demand = demandForCounts(metric?.recentBookings, metric?.expectedBookings, pricing);
  const comparable = store.vehicles.filter((item) => item.status === "ACTIVE" &&
    item.maintenanceStatus === "OK" && item.cityId === vehicle.cityId && item.type === vehicle.type);
  const availableComparable = comparable.filter((item) =>
    !hasConflict(item.id, input.pickupAt, input.returnAt) &&
    !store.maintenancePeriods.some((period) => period.vehicleId === item.id &&
      isOverlap(period.startsAt, period.endsAt, input.pickupAt, input.returnAt)));
  const availability = availabilityForCounts(availableComparable.length, comparable.length, pricing);
  const matchingPeaks = store.peakDates.filter((period) => period.active &&
    (!period.cityId || period.cityId === vehicle.cityId) &&
    (!period.locationId || period.locationId === vehicle.locationId) &&
    isOverlap(period.startsAt, period.endsAt, input.pickupAt, input.returnAt));
  const selectedPeak = matchingPeaks.sort((left, right) => Number(right.multiplier || pricing.peakMultiplier) - Number(left.multiplier || pricing.peakMultiplier))[0];
  const peakMultiplier = selectedPeak ? Number(selectedPeak.multiplier || pricing.peakMultiplier) : 1;
  const daysInAdvance = Math.max(0, Math.floor((new Date(input.pickupAt) - Date.now()) / (24 * 60 * 60 * 1000)));
  const breakdown = calculatePrice({
    baseDailyRate: vehicle.baseDailyRate,
    baseHourlyRate: vehicle.baseHourlyRate,
    pickupAt: input.pickupAt,
    returnAt: input.returnAt,
    demandMultiplier: demand.multiplier,
    availabilityMultiplier: availability.multiplier,
    peakMultiplier,
    durationDiscountPercent: Number(pricing.durationDiscountPercent),
    earlyBookingDiscountPercent: Number(pricing.earlyBookingDiscountPercent || 0),
    earlyBookingMinimumDays: Number(pricing.earlyBookingMinimumDays || 14),
    daysInAdvance,
    bookingFee: Number(pricing.bookingFee || 0),
    taxPercent: Number(pricing.taxPercent),
    minimumDailyRate: vehicle.minDailyRate,
    maximumDailyRate: vehicle.maxDailyRate,
    currency,
    demandScore: demand.score,
    demandRecentBookings: metric?.recentBookings ?? null,
    demandExpectedBookings: metric?.expectedBookings ?? null,
    availabilityRatio: availability.ratio,
    availableComparableVehicles: availability.available,
    comparableVehicleCount: availability.total,
    applicablePeakRules: selectedPeak ? [selectedPeak.name] : [],
    ruleVersion: pricing.ruleVersion || "demo-v2"
  });
  return {
    breakdown,
    demandMultiplier: demand.multiplier,
    demandLevel: demand.level,
    demandScore: demand.score,
    availabilityMultiplier: availability.multiplier,
    availabilityLevel: availability.level,
    availabilityRatio: availability.ratio,
    peakMultiplier,
    matchingPeak: selectedPeak?.name || null
  };
}
async function cleanExpiredHolds() {
  const now = Date.now();
  let changed = false;
  for (const booking of store.bookings) {
    if (booking.status === "PENDING" && Date.parse(booking.holdExpiresAt) <= now) {
      booking.status = "EXPIRED";
      booking.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await persist();
}
function pricingSettingsApi() {
  const settings = store.pricing;
  return {
    ...settings,
    duration_discount_percent: settings.durationDiscountPercent,
    low_demand_multiplier: settings.lowDemandMultiplier,
    normal_demand_multiplier: settings.normalDemandMultiplier,
    high_demand_multiplier: settings.highDemandMultiplier,
    low_availability_multiplier: settings.availabilityHighMultiplier,
    peak_multiplier: settings.peakMultiplier,
    tax_percent: settings.taxPercent,
    early_booking_discount_percent: settings.earlyBookingDiscountPercent,
    early_booking_minimum_days: settings.earlyBookingMinimumDays,
    booking_fee: settings.bookingFee,
    demand_low_score: settings.demandLowScore,
    demand_normal_score: settings.demandNormalScore,
    demand_elevated_score: settings.demandElevatedScore,
    demand_elevated_multiplier: settings.demandElevatedMultiplier,
    availability_low_ratio: settings.availabilityLowRatio,
    availability_medium_ratio: settings.availabilityMediumRatio,
    availability_medium_multiplier: settings.availabilityMediumMultiplier
  };
}
function peakDateApi(period) {
  return { ...period, starts_at: period.startsAt, ends_at: period.endsAt };
}
function voidOrRefundPayment(bookingId) {
  const payment = store.payments.find((item) => item.bookingId === bookingId);
  if (!payment || payment.status === "FAILED" || payment.status === "REFUNDED") return;
  payment.status = payment.status === "PAID" ? "REFUNDED" : "FAILED";
  payment.transactionRef = payment.status === "REFUNDED"
    ? `MOCK-REFUND-${bookingId}` : payment.transactionRef;
  payment.updatedAt = new Date().toISOString();
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", database: databaseType }));
app.get("/api/cities", (_req, res) => res.json(store.cities));
app.get("/api/vehicle-types", (_req, res) => res.json(store.vehicleTypes));
app.get("/api/locations", (req, res) => {
  const locations = store.locations.filter((location) => location.active &&
    (!req.query.cityId || location.cityId === req.query.cityId));
  res.json(locations);
});

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const email = input.email.toLowerCase();
  if (store.users.some((user) => user.email === email)) return res.status(409).json({ error: "Email is already registered" });
  const user = {
    id: newId(), name: input.name, email, passwordHash: await bcrypt.hash(input.password, 12),
    role: "CUSTOMER", createdAt: new Date().toISOString()
  };
  if (store.users.some((existing) => existing.email === email)) return res.status(409).json({ error: "Email is already registered" });
  store.users.push(user);
  await persist();
  const { passwordHash: _passwordHash, ...safeUser } = user;
  res.status(201).json({ user: safeUser, token: tokenFor(user) });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const input = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user = store.users.find((item) => item.email === input.email.toLowerCase());
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    return res.status(401).json({ error: "Email or password is incorrect" });
  }
  const { passwordHash: _passwordHash, ...safeUser } = user;
  res.json({ user: safeUser, token: tokenFor(user) });
}));

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = store.users.find((item) => item.id === req.user.sub);
  if (!user) return res.status(401).json({ error: "User account no longer exists" });
  const { passwordHash: _passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.get("/api/vehicles", (req, res) => {
  let vehicles = store.vehicles.filter((vehicle) => vehicle.status === "ACTIVE" && vehicle.maintenanceStatus === "OK");
  const hasPickupAt = Boolean(req.query.pickupAt);
  const hasReturnAt = Boolean(req.query.returnAt);
  if (hasPickupAt !== hasReturnAt) {
    return res.status(400).json({ error: "Select both pickup and return dates to filter availability" });
  }
  if (hasPickupAt) {
    const period = z.object({
      pickupAt: z.string().datetime({ offset: true }),
      returnAt: z.string().datetime({ offset: true })
    }).refine((value) => new Date(value.returnAt) > new Date(value.pickupAt), {
      message: "Return time must be after pickup time"
    }).parse({
      pickupAt: String(req.query.pickupAt),
      returnAt: String(req.query.returnAt)
    });
    vehicles = vehicles.filter((vehicle) =>
      !hasConflict(vehicle.id, period.pickupAt, period.returnAt) &&
      !store.maintenancePeriods.some((maintenance) => maintenance.vehicleId === vehicle.id &&
        isOverlap(maintenance.startsAt, maintenance.endsAt, period.pickupAt, period.returnAt)));
  }
  if (req.query.q) {
    const query = String(req.query.q).trim().toLowerCase();
    vehicles = vehicles.filter((vehicle) => `${vehicle.name} ${vehicle.brand} ${vehicle.model}`.toLowerCase().includes(query));
  }
  if (req.query.type) vehicles = vehicles.filter((vehicle) => vehicle.type === String(req.query.type).toUpperCase());
  if (req.query.category) vehicles = vehicles.filter((vehicle) => vehicle.category === String(req.query.category).toUpperCase());
  if (req.query.cityId) vehicles = vehicles.filter((vehicle) => vehicle.cityId === req.query.cityId);
  if (req.query.locationId) vehicles = vehicles.filter((vehicle) => vehicle.locationId === req.query.locationId);
  if (req.query.maxRate && Number.isFinite(Number(req.query.maxRate))) {
    vehicles = vehicles.filter((vehicle) => vehicle.baseDailyRate <= Number(req.query.maxRate));
  }
  if (req.query.fuelType) vehicles = vehicles.filter((vehicle) => vehicle.fuelType === String(req.query.fuelType).toUpperCase());
  if (req.query.transmission) vehicles = vehicles.filter((vehicle) => vehicle.transmission === String(req.query.transmission).toUpperCase());
  if (req.query.minSeats && Number.isFinite(Number(req.query.minSeats))) {
    vehicles = vehicles.filter((vehicle) => Number(vehicle.seatingCapacity) >= Number(req.query.minSeats));
  }
  if (req.query.sort === "price-asc") vehicles.sort((a, b) => a.baseDailyRate - b.baseDailyRate);
  if (req.query.sort === "price-desc") vehicles.sort((a, b) => b.baseDailyRate - a.baseDailyRate);
  if (req.query.sort === "rating") vehicles.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
  res.json(vehicles.slice(0, 500).map(vehiclePublic));
});

app.get("/api/vehicles/:id/availability", (req, res, next) => {
  try {
    const input = rentalSchema.parse({
      vehicleId: req.params.id,
      pickupAt: req.query.pickupAt,
      returnAt: req.query.returnAt
    });
    const vehicle = store.vehicles.find((item) => item.id === input.vehicleId);
    if (!vehicle || vehicle.status !== "ACTIVE" || vehicle.maintenanceStatus !== "OK") {
      return res.json({ available: false, reason: "Vehicle is inactive or under maintenance" });
    }
    if (hasConflict(vehicle.id, input.pickupAt, input.returnAt)) {
      return res.json({ available: false, reason: "Vehicle is already reserved for part of this period" });
    }
    if (store.maintenancePeriods.some((period) => period.vehicleId === vehicle.id &&
        isOverlap(period.startsAt, period.endsAt, input.pickupAt, input.returnAt))) {
      return res.json({ available: false, reason: "Vehicle has a maintenance block during this period" });
    }
    res.json({ available: true });
  } catch (error) { next(error); }
});

app.get("/api/vehicles/:id", (req, res) => {
  const vehicle = store.vehicles.find((item) => item.id === req.params.id && item.status === "ACTIVE");
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  res.json(vehiclePublic(vehicle));
});

app.post("/api/pricing/quote", requireAuth, async (req, res, next) => {
  try {
    const input = rentalSchema.parse(req.body);
    const vehicle = store.vehicles.find((item) => item.id === input.vehicleId);
    const factors = getFactors(vehicle, input);
    const quote = {
      id: newId(), userId: req.user.sub, vehicleId: vehicle.id,
      pickupAt: input.pickupAt, returnAt: input.returnAt,
      breakdown: { ...factors.breakdown, demandMultiplier: factors.demandMultiplier,
        demandLevel: factors.demandLevel, demandScore: factors.demandScore,
        availabilityMultiplier: factors.availabilityMultiplier, availabilityLevel: factors.availabilityLevel,
        availabilityRatio: factors.availabilityRatio, matchingPeak: factors.matchingPeak,
        availabilityAdjustment: factors.breakdown.availabilityAdjustment,
        peakMultiplier: factors.peakMultiplier },
      final_total: factors.breakdown.total, currency, created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + quoteMinutes * 60 * 1000).toISOString(),
      pickup_location_id: vehicle.locationId,
      rule_version: store.pricing.ruleVersion || "demo-v2"
    };
    store.quotes.unshift(quote);
    store.priceHistory.unshift({ ...quote, vehicleName: vehicle.name });
    store.priceHistory.splice(200);
    await persist();
    res.status(201).json({ quote });
  } catch (error) { next(error); }
});

app.post("/api/admin/pricing-simulator", ...admin, (req, res, next) => {
  try {
    const input = z.object({
      vehicleId: z.string().uuid(),
      pickupAt: z.string().datetime({ offset: true }),
      returnAt: z.string().datetime({ offset: true }),
      recentBookings: z.number().int().min(0),
      expectedBookings: z.number().int().min(1),
      availableVehicles: z.number().int().min(0),
      comparableVehicles: z.number().int().min(1),
      peakEnabled: z.boolean()
    }).refine((value) => new Date(value.returnAt) > new Date(value.pickupAt), {
      message: "Return time must be after pickup time"
    }).parse(req.body);
    const vehicle = store.vehicles.find((item) => item.id === input.vehicleId);
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    const demand = demandForCounts(input.recentBookings, input.expectedBookings, store.pricing);
    const availability = availabilityForCounts(input.availableVehicles, input.comparableVehicles, store.pricing);
    const overrides = req.body.overrides ? z.object({
      baseDailyRate: z.number().positive().optional(),
      minimumDailyRate: z.number().nonnegative().optional(),
      maximumDailyRate: z.number().positive().optional(),
      durationDiscountPercent: z.number().min(0).max(100).optional(),
      earlyBookingDiscountPercent: z.number().min(0).max(100).optional(),
      bookingFee: z.number().nonnegative().optional(),
      taxPercent: z.number().min(0).max(100).optional()
    }).parse(req.body.overrides) : {};
    const result = calculatePrice({
      baseDailyRate: overrides.baseDailyRate ?? vehicle.baseDailyRate,
      baseHourlyRate: vehicle.baseHourlyRate,
      pickupAt: input.pickupAt,
      returnAt: input.returnAt,
      demandMultiplier: demand.multiplier,
      availabilityMultiplier: availability.multiplier,
      peakMultiplier: input.peakEnabled ? Number(store.pricing.peakMultiplier) : 1,
      durationDiscountPercent: overrides.durationDiscountPercent ?? Number(store.pricing.durationDiscountPercent),
      earlyBookingDiscountPercent: overrides.earlyBookingDiscountPercent ?? Number(store.pricing.earlyBookingDiscountPercent || 0),
      earlyBookingMinimumDays: Number(store.pricing.earlyBookingMinimumDays || 14),
      daysInAdvance: Math.max(0, Math.floor((new Date(input.pickupAt) - Date.now()) / 86400000)),
      bookingFee: overrides.bookingFee ?? Number(store.pricing.bookingFee || 0),
      taxPercent: overrides.taxPercent ?? Number(store.pricing.taxPercent),
      minimumDailyRate: overrides.minimumDailyRate ?? vehicle.minDailyRate,
      maximumDailyRate: overrides.maximumDailyRate ?? vehicle.maxDailyRate,
      currency,
      demandScore: demand.score,
      demandRecentBookings: input.recentBookings,
      demandExpectedBookings: input.expectedBookings,
      availabilityRatio: availability.ratio,
      availableComparableVehicles: availability.available,
      comparableVehicleCount: availability.total,
      applicablePeakRules: input.peakEnabled ? ["Simulator peak period"] : [],
      ruleVersion: store.pricing.ruleVersion || "demo-v2"
    });
    res.json({
      vehicleId: vehicle.id,
      cityId: vehicle.cityId,
      pickupLocationId: vehicle.locationId,
      simulated: true,
      quote: result,
      demandLevel: demand.level,
      demandDataSufficient: demand.sufficientData,
      availabilityLevel: availability.level,
      percentChangeFromBase: result.baseRentalAmount
        ? Number(((result.total - result.baseRentalAmount) / result.baseRentalAmount * 100).toFixed(2))
        : 0
    });
  } catch (error) { next(error); }
});

app.get("/api/pricing/quotes/:id", requireAuth, (req, res) => {
  const quote = store.quotes.find((item) => item.id === req.params.id && item.userId === req.user.sub);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  res.json({ quote, expired: Date.parse(quote.expires_at) <= Date.now() });
});

app.post("/api/bookings", requireAuth, async (req, res, next) => {
  try {
    await cleanExpiredHolds();
    const input = z.object({ quoteId: z.string().uuid() }).parse(req.body);
    const quote = store.quotes.find((item) => item.id === input.quoteId && item.userId === req.user.sub);
    if (!quote || Date.parse(quote.expires_at) <= Date.now()) {
      return res.status(410).json({ error: "Quote expired; request a new quote" });
    }
    const vehicle = store.vehicles.find((item) => item.id === quote.vehicleId);
    const factors = getFactors(vehicle, quote);
    if (Number(factors.breakdown.total) !== Number(quote.final_total)) {
      return res.status(409).json({ error: "Price changed; create a new quote and confirm the updated total" });
    }
    const now = new Date().toISOString();
    const booking = {
      id: newId(), userId: req.user.sub, vehicleId: vehicle.id, quoteId: quote.id,
      pickupAt: quote.pickupAt, returnAt: quote.returnAt, status: "PENDING",
      total_price: quote.final_total, currency, holdExpiresAt: new Date(Date.now() + holdMinutes * 60 * 1000).toISOString(),
      createdAt: now, updatedAt: now, breakdown: quote.breakdown
    };
    const payment = {
      id: newId(), bookingId: booking.id, provider: "MOCK", status: "PENDING",
      amount: booking.total_price, createdAt: now, updatedAt: now
    };
    const savedInMysql = await createReservation(booking, payment);
    store.bookings.unshift(booking);
    store.payments.push(payment);
    if (!savedInMysql) await persist();
    res.status(201).json({ booking, paymentMessage: "Temporary booking hold created. Complete mock payment before it expires." });
  } catch (error) { next(error); }
});

app.post("/api/payments/mock-checkout", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({ bookingId: z.string().uuid(), simulate: z.enum(["success", "failure"]) }).parse(req.body);
    const booking = store.bookings.find((item) => item.id === input.bookingId && item.userId === req.user.sub);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    const payment = store.payments.find((item) => item.bookingId === booking.id);
    if (payment?.status === "PAID") return res.json({ paymentStatus: "PAID", bookingStatus: "CONFIRMED", idempotent: true });
    if (booking.status !== "PENDING" || Date.parse(booking.holdExpiresAt) <= Date.now()) {
      return res.status(409).json({ error: "Booking hold has expired or is no longer payable" });
    }
    if (!payment || payment.status !== "PENDING") return res.status(409).json({ error: "Payment was already processed" });
    const succeeded = input.simulate === "success";
    payment.status = succeeded ? "PAID" : "FAILED";
    payment.transactionRef = `MOCK-${booking.id}`;
    payment.updatedAt = new Date().toISOString();
    booking.status = succeeded ? "CONFIRMED" : "EXPIRED";
    booking.holdExpiresAt = null;
    booking.updatedAt = new Date().toISOString();
    if (succeeded) audit(req.user.sub, "MOCK_PAYMENT_SUCCEEDED", "RESERVATION", booking.id);
    await persist();
    res.json({ paymentStatus: payment.status, bookingStatus: booking.status });
  } catch (error) { next(error); }
});

app.get("/api/bookings/my", requireAuth, asyncRoute(async (req, res) => {
  await cleanExpiredHolds();
  const bookings = store.bookings.filter((booking) => booking.userId === req.user.sub)
    .map((booking) => {
      const vehicle = store.vehicles.find((item) => item.id === booking.vehicleId);
      const payment = store.payments.find((item) => item.bookingId === booking.id);
      return { ...booking, pickup_at: booking.pickupAt, return_at: booking.returnAt,
        vehicle_name: vehicle?.name, brand: vehicle?.brand, model: vehicle?.model,
        payment_status: payment?.status, price_breakdown: booking.breakdown };
    });
  res.json(bookings);
}));

app.get("/api/bookings/:id", requireAuth, (req, res) => {
  const booking = store.bookings.find((item) => item.id === req.params.id &&
    (item.userId === req.user.sub || req.user.role === "ADMIN"));
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  const vehicle = store.vehicles.find((item) => item.id === booking.vehicleId);
  const payment = store.payments.find((item) => item.bookingId === booking.id);
  const location = store.locations.find((item) => item.id === vehicle?.locationId);
  res.json({
    booking: { ...booking, pickup_at: booking.pickupAt, return_at: booking.returnAt,
      vehicle_name: vehicle?.name, vehicle_brand: vehicle?.brand, vehicle_model: vehicle?.model,
      location_name: location?.name, city_name: location?.cityName, payment_status: payment?.status },
    priceSnapshot: booking.breakdown,
    payment: payment ? { status: payment.status, provider: payment.provider, transactionRef: payment.transactionRef } : null,
    demoMode: true
  });
});

app.post("/api/bookings/:id/cancel", requireAuth, asyncRoute(async (req, res) => {
  const booking = store.bookings.find((item) => item.id === req.params.id && item.userId === req.user.sub);
  if (!booking || !["PENDING", "CONFIRMED"].includes(booking.status) ||
      Date.parse(booking.pickupAt) <= Date.now() + 24 * 60 * 60 * 1000) {
    return res.status(409).json({ error: "Only bookings more than 24 hours away can be cancelled" });
  }
  booking.status = "CANCELLED";
  booking.updatedAt = new Date().toISOString();
  voidOrRefundPayment(booking.id);
  audit(req.user.sub, "CANCEL", "RESERVATION", booking.id);
  await persist();
  res.json({ booking: { id: booking.id, status: booking.status } });
}));

app.get("/api/admin/dashboard", ...admin, (_req, res) => {
  const active = store.vehicles.filter((vehicle) => vehicle.status === "ACTIVE").length;
  const confirmed = store.bookings.filter((booking) => booking.status === "CONFIRMED");
  const cancellations = store.bookings.filter((booking) => booking.status === "CANCELLED").length;
  const revenue = confirmed.filter((booking) => store.payments.some((payment) =>
    payment.bookingId === booking.id && payment.status === "PAID"))
    .reduce((sum, booking) => sum + Number(booking.total_price), 0);
  res.json({
    active_vehicles: active, confirmed_bookings: confirmed.length,
    paid_revenue: revenue.toFixed(2), cancellations,
    cancellation_rate: store.bookings.length ? Number((cancellations * 100 / store.bookings.length).toFixed(1)) : 0,
    sample_vehicles: store.vehicles.length,
    configured_locations: store.locations.length,
    mock_reservations: store.bookings.length,
    simulated_revenue: revenue.toFixed(2),
    unavailable_vehicles: store.vehicles.filter((vehicle) =>
      vehicle.status !== "ACTIVE" || vehicle.maintenanceStatus !== "OK").length,
    recent_price_changes: store.priceHistory.length,
    simulated_demand_level: "DEMO DATA"
  });
});

app.get("/api/admin/analytics", ...admin, (_req, res) => {
  const end = Date.now();
  const start = end - 7 * 24 * 60 * 60 * 1000;
  const confirmed = store.bookings.filter((booking) => booking.status === "CONFIRMED");
  const activeVehicles = store.vehicles.filter((vehicle) => vehicle.status === "ACTIVE").length;
  let bookedMilliseconds = 0;
  for (const booking of confirmed) {
    bookedMilliseconds += Math.max(0,
      Math.min(Date.parse(booking.returnAt), end) - Math.max(Date.parse(booking.pickupAt), start));
  }
  const utilizationRate = activeVehicles
    ? Number((bookedMilliseconds / (activeVehicles * 7 * 24 * 60 * 60 * 1000) * 100).toFixed(1))
    : 0;
  const dailyTrends = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(end - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dayBookings = store.bookings.filter((booking) => booking.createdAt.slice(0, 10) === date);
    dailyTrends.push({
      date,
      bookings: dayBookings.length,
      paidRevenue: dayBookings.filter((booking) => store.payments.some((payment) =>
        payment.bookingId === booking.id && payment.status === "PAID"))
        .reduce((sum, booking) => sum + Number(booking.total_price), 0)
    });
  }
  const demandByType = store.vehicleTypes.map((type) => ({
    type: type.name,
    bookings: store.bookings.filter((booking) => {
      const vehicle = store.vehicles.find((item) => item.id === booking.vehicleId);
      return vehicle?.typeId === type.id && Date.parse(booking.createdAt) >= start;
    }).length
  }));
  const revenueByLocation = store.locations.map((location) => ({
    location: location.name,
    revenue: store.bookings.filter((booking) => {
      const vehicle = store.vehicles.find((item) => item.id === booking.vehicleId);
      return vehicle?.locationId === location.id &&
        store.payments.some((payment) => payment.bookingId === booking.id && payment.status === "PAID");
    }).reduce((sum, booking) => sum + Number(booking.total_price), 0)
  }));
  const demandByCity = store.cities.map((city) => ({
    city: city.name,
    bookings: store.demandMetrics.filter((metric) => metric.cityId === city.id)
      .reduce((sum, metric) => sum + Number(metric.recentBookings || 0), 0)
  }));
  const durationDistribution = [
    { duration: "Hourly (<1 day)", count: confirmed.filter((booking) => (Date.parse(booking.returnAt) - Date.parse(booking.pickupAt)) < 86400000).length },
    { duration: "1–2 days", count: confirmed.filter((booking) => {
      const days = (Date.parse(booking.returnAt) - Date.parse(booking.pickupAt)) / 86400000;
      return days >= 1 && days < 3;
    }).length },
    { duration: "3+ days", count: confirmed.filter((booking) => (Date.parse(booking.returnAt) - Date.parse(booking.pickupAt)) >= 3 * 86400000).length }
  ];
  res.json({
    utilization_rate: utilizationRate,
    daily_trends: dailyTrends,
    demand_by_type: demandByType,
    demand_by_city: demandByCity,
    revenue_by_location: revenueByLocation,
    duration_distribution: durationDistribution,
    sample_data: true
  });
});

app.get("/api/admin/bookings", ...admin, (_req, res) => {
  res.json(store.bookings.slice(0, 200).map((booking) => {
    const user = store.users.find((item) => item.id === booking.userId);
    const vehicle = store.vehicles.find((item) => item.id === booking.vehicleId);
    const payment = store.payments.find((item) => item.bookingId === booking.id);
    return { ...booking, customer_name: user?.name, email: user?.email, vehicle_name: vehicle?.name, payment_status: payment?.status };
  }));
});

app.post("/api/admin/vehicles", ...admin, async (req, res, next) => {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(120), brand: z.string().trim().min(1).max(100),
      model: z.string().trim().min(1).max(100), typeId: z.string().uuid(), locationId: z.string().uuid(),
      baseDailyRate: z.number().positive(), baseHourlyRate: z.number().positive(),
      minDailyRate: z.number().nonnegative(), maxDailyRate: z.number().positive(),
      description: z.string().max(2000).optional(), imageUrl: z.string().url().optional()
    }).parse(req.body);
    if (input.minDailyRate > input.maxDailyRate) return res.status(400).json({ error: "Minimum rate must not exceed maximum rate" });
    const type = store.vehicleTypes.find((item) => item.id === input.typeId);
    const location = store.locations.find((item) => item.id === input.locationId && item.active);
    if (!type || !location) return res.status(400).json({ error: "Choose an existing vehicle type and active location" });
    const vehicle = {
      id: newId(), ...input, type: type.name, typeId: type.id,
      pricingTier: type.name, pricingTierLabel: type.name,
      category: ["BIKE", "SCOOTER"].includes(type.name) ? "TWO_WHEELER"
        : type.name === "COMMERCIAL" ? "COMMERCIAL" : "FOUR_WHEELER",
      subcategory: type.name, locationName: location.name, cityId: location.cityId,
      city: location.cityName, country: "India", fuelType: "PETROL", transmission: "MANUAL",
      seatingCapacity: ["BIKE", "SCOOTER"].includes(type.name) ? 2 : 5,
      description: input.description || "", features: [], specifications: {},
      imageUrl: input.imageUrl || "", fallbackImageUrl: input.imageUrl || "",
      status: "ACTIVE", maintenanceStatus: "OK", createdAt: new Date().toISOString()
    };
    store.vehicles.unshift(vehicle);
    audit(req.user.sub, "CREATE", "VEHICLE", vehicle.id);
    await persist();
    res.status(201).json({ vehicle: vehiclePublic(vehicle) });
  } catch (error) { next(error); }
});

app.patch("/api/admin/vehicles/:id", ...admin, async (req, res, next) => {
  try {
    const input = z.object({
      status: z.enum(["ACTIVE", "INACTIVE", "MAINTENANCE"]).optional(),
      maintenanceStatus: z.enum(["OK", "NEEDS_SERVICE", "IN_MAINTENANCE"]).optional(),
      name: z.string().trim().min(2).max(120).optional(),
      brand: z.string().trim().min(1).max(100).optional(),
      model: z.string().trim().min(1).max(100).optional(),
      baseDailyRate: z.number().positive().optional(),
      baseHourlyRate: z.number().positive().optional(),
      minDailyRate: z.number().nonnegative().optional(),
      maxDailyRate: z.number().positive().optional(),
      description: z.string().max(2000).optional(),
      imageUrl: z.string().url().optional()
    }).refine((value) => Object.keys(value).length > 0).parse(req.body);
    const vehicle = store.vehicles.find((item) => item.id === req.params.id);
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    const minRate = input.minDailyRate ?? vehicle.minDailyRate;
    const maxRate = input.maxDailyRate ?? vehicle.maxDailyRate;
    if (minRate > maxRate) return res.status(400).json({ error: "Minimum rate must not exceed maximum rate" });
    Object.assign(vehicle, input, { updatedAt: new Date().toISOString() });
    audit(req.user.sub, "UPDATE", "VEHICLE", vehicle.id, input);
    await persist();
    res.json({ vehicle: vehiclePublic(vehicle) });
  } catch (error) { next(error); }
});

app.get("/api/admin/pricing-settings", ...admin, (_req, res) => res.json(pricingSettingsApi()));
app.patch("/api/admin/pricing-settings", ...admin, async (req, res, next) => {
  try {
    const input = z.object({
      durationDiscountPercent: z.number().min(0).max(50),
      taxPercent: z.number().min(0).max(30),
      earlyBookingDiscountPercent: z.number().min(0).max(50),
      earlyBookingMinimumDays: z.number().int().min(0).max(365),
      bookingFee: z.number().nonnegative().max(100000),
      lowDemandMultiplier: z.number().min(0.5).max(1.5),
      normalDemandMultiplier: z.number().min(0.5).max(2),
      highDemandMultiplier: z.number().min(0.5).max(2),
      demandLowScore: z.number().min(0).max(1000),
      demandNormalScore: z.number().min(0).max(1000),
      demandElevatedScore: z.number().min(0).max(1000),
      demandElevatedMultiplier: z.number().min(0.5).max(2),
      lowAvailabilityMultiplier: z.number().min(0.5).max(2),
      peakMultiplier: z.number().min(0.5).max(2),
      availabilityLowRatio: z.number().min(0).max(1),
      availabilityMediumRatio: z.number().min(0).max(1),
      availabilityMediumMultiplier: z.number().min(0.5).max(2)
    }).parse(req.body);
    if (input.demandLowScore >= input.demandNormalScore ||
        input.demandNormalScore >= input.demandElevatedScore ||
        input.availabilityLowRatio >= input.availabilityMediumRatio) {
      return res.status(400).json({ error: "Demand and availability thresholds must be strictly increasing" });
    }
    store.pricing = {
      ...store.pricing,
      ...input,
      availabilityHighMultiplier: input.lowAvailabilityMultiplier,
      availabilityMediumMultiplier: input.availabilityMediumMultiplier,
      ruleVersion: `demo-${Date.now()}`
    };
    audit(req.user.sub, "UPDATE", "PRICING_SETTINGS", null, input);
    await persist();
    res.json(pricingSettingsApi());
  } catch (error) { next(error); }
});

app.get("/api/admin/peak-dates", ...admin, (_req, res) => res.json(store.peakDates.map(peakDateApi)));
app.post("/api/admin/peak-dates", ...admin, async (req, res, next) => {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
      cityId: z.string().optional(),
      locationId: z.string().uuid().optional(),
      multiplier: z.number().min(0.5).max(2).optional()
    }).refine((value) => new Date(value.endsAt) > new Date(value.startsAt), { message: "Peak period end must be after start" }).parse(req.body);
    if (input.cityId && !store.cities.some((city) => city.id === input.cityId)) {
      return res.status(400).json({ error: "Unknown city" });
    }
    if (input.locationId && !store.locations.some((location) => location.id === input.locationId)) {
      return res.status(400).json({ error: "Unknown pickup location" });
    }
    const peakDate = { id: newId(), ...input, active: true, createdAt: new Date().toISOString() };
    store.peakDates.unshift(peakDate);
    audit(req.user.sub, "CREATE", "PEAK_DATE", peakDate.id);
    await persist();
    res.status(201).json({ peakDate: peakDateApi(peakDate) });
  } catch (error) { next(error); }
});
app.delete("/api/admin/peak-dates/:id", ...admin, asyncRoute(async (req, res) => {
  const peak = store.peakDates.find((item) => item.id === req.params.id);
  if (!peak) return res.status(404).json({ error: "Peak date not found" });
  peak.active = false;
  audit(req.user.sub, "DEACTIVATE", "PEAK_DATE", peak.id);
  await persist();
  res.status(204).end();
}));

app.post("/api/admin/maintenance-periods", ...admin, async (req, res, next) => {
  try {
    const input = z.object({
      vehicleId: z.string().uuid(), startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }), reason: z.string().max(1000).optional()
    }).refine((value) => new Date(value.endsAt) > new Date(value.startsAt), { message: "Maintenance end must be after start" }).parse(req.body);
    if (!store.vehicles.some((vehicle) => vehicle.id === input.vehicleId)) return res.status(404).json({ error: "Vehicle not found" });
    const period = { id: newId(), ...input, createdAt: new Date().toISOString() };
    store.maintenancePeriods.unshift(period);
    audit(req.user.sub, "CREATE", "MAINTENANCE_PERIOD", period.id);
    await persist();
    res.status(201).json({ maintenancePeriod: period });
  } catch (error) { next(error); }
});
app.get("/api/admin/maintenance-periods", ...admin, (_req, res) => {
  res.json(store.maintenancePeriods.map((period) => ({
    ...period,
    vehicleName: store.vehicles.find((vehicle) => vehicle.id === period.vehicleId)?.name
  })));
});
app.delete("/api/admin/maintenance-periods/:id", ...admin, asyncRoute(async (req, res) => {
  const index = store.maintenancePeriods.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Maintenance period not found" });
  store.maintenancePeriods.splice(index, 1);
  audit(req.user.sub, "DELETE", "MAINTENANCE_PERIOD", req.params.id);
  await persist();
  res.status(204).end();
}));

app.patch("/api/admin/bookings/:id/status", ...admin, async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(["CANCELLED", "COMPLETED"]) }).parse(req.body);
    const booking = store.bookings.find((item) => item.id === req.params.id &&
      (status === "COMPLETED" ? item.status === "CONFIRMED" : ["CONFIRMED", "PENDING"].includes(item.status)));
    if (!booking) return res.status(409).json({ error: "Booking not found or transition is not allowed" });
    booking.status = status;
    booking.updatedAt = new Date().toISOString();
    if (status === "CANCELLED") voidOrRefundPayment(booking.id);
    audit(req.user.sub, "UPDATE", "RESERVATION", booking.id, { status });
    await persist();
    res.json({ booking: { id: booking.id, status: booking.status } });
  } catch (error) { next(error); }
});

app.get("/api/admin/price-history", ...admin, (_req, res) => res.json(store.priceHistory.slice(0, 200)));
app.get("/api/admin/audit-logs", ...admin, (_req, res) => {
  res.json(store.auditLogs.slice(0, 200).map((entry) => ({
    ...entry, email: store.users.find((user) => user.id === entry.userId)?.email
  })));
});

// Serve the compiled React static files
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// Catch-all route to hand off client-side routing to React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request", details: error.issues });
  if (error.status) return res.status(error.status).json({ error: error.message });
  console.error(error);
  return res.status(500).json({ error: "Internal server error" });
});

async function start() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password && !store.users.some((user) => user.email === email)) {
    store.users.push({
      id: newId(), name: process.env.ADMIN_NAME || "Rental Administrator", email,
      passwordHash: await bcrypt.hash(password, 12), role: "ADMIN", createdAt: new Date().toISOString()
    });
    await persist();
    console.log(`Created initial administrator account: ${email}`);
  }
  const server = app.listen(port, () => console.log(`API listening at http://localhost:${port}`));
  function shutdown() {
    server.close(async () => {
      try {
        await shutdownStore();
        process.exit(0);
      } catch (error) {
        console.error("Could not close storage cleanly", error);
        process.exitCode = 1;
      }
    });
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Could not start API", error);
  process.exitCode = 1;
});
