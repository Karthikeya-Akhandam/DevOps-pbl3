import mysql from "mysql2/promise";
import { initialDemoStore } from "./data/catalogue.js";

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  timezone: "Z",
  decimalNumbers: true
});

const json = (value) => JSON.stringify(value ?? {});
const date = (value) => value ? new Date(value) : null;
const iso = (value) => value ? new Date(value).toISOString() : null;
const parsedJson = (value, fallback = {}) => typeof value === "string" ? JSON.parse(value) : value ?? fallback;

function mapPricing(row, baseline) {
  if (!row) return baseline;
  return {
    ...baseline,
    ruleVersion: row.rule_version,
    durationDiscountPercent: Number(row.duration_discount_percent),
    earlyBookingDiscountPercent: Number(row.early_booking_discount_percent),
    earlyBookingMinimumDays: Number(row.early_booking_minimum_days),
    bookingFee: Number(row.booking_fee),
    taxPercent: Number(row.tax_percent),
    demandLowScore: Number(row.demand_low_score),
    demandNormalScore: Number(row.demand_normal_score),
    demandElevatedScore: Number(row.demand_elevated_score),
    lowDemandMultiplier: Number(row.low_demand_multiplier),
    normalDemandMultiplier: Number(row.normal_demand_multiplier),
    demandElevatedMultiplier: Number(row.elevated_demand_multiplier),
    highDemandMultiplier: Number(row.high_demand_multiplier),
    availabilityLowRatio: Number(row.availability_low_ratio),
    availabilityMediumRatio: Number(row.availability_medium_ratio),
    availabilityHighMultiplier: Number(row.low_availability_multiplier),
    lowAvailabilityMultiplier: Number(row.low_availability_multiplier),
    availabilityMediumMultiplier: Number(row.medium_availability_multiplier),
    availabilityNormalMultiplier: 1,
    peakMultiplier: Number(row.peak_multiplier)
  };
}

async function seedCatalogue(baseline, connection) {
  for (const city of baseline.cities) {
    await connection.execute(
      "INSERT IGNORE INTO cities (id,name,country,active) VALUES (?,?,?,TRUE)",
      [city.id, city.name, city.country]
    );
  }
  for (const type of baseline.vehicleTypes) {
    await connection.execute("INSERT IGNORE INTO vehicle_types (id,name) VALUES (?,?)", [type.id, type.name]);
  }
  for (const location of baseline.locations) {
    await connection.execute(
      "INSERT IGNORE INTO rental_locations (id,city_id,name,type,address_description,active) VALUES (?,?,?,?,?,?)",
      [location.id, location.cityId, location.name, location.type, location.addressDescription, location.active]
    );
  }
  for (const vehicle of baseline.vehicles) {
    await connection.execute(
      `INSERT IGNORE INTO vehicles
       (id,name,brand,model,type_id,category,subcategory,city_id,location_id,fuel_type,transmission,
        seating_capacity,description,specifications,features,image_url,fallback_image_url,base_daily_rate,
        base_hourly_rate,min_daily_rate,max_daily_rate,status,maintenance_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      vehicleValues(vehicle)
    );
  }
  for (const metric of baseline.demandMetrics) {
    await connection.execute(
      `INSERT IGNORE INTO demand_metrics
       (id,city_id,category,recent_bookings,expected_bookings,window_days,source)
       VALUES (?,?,?,?,?,?,?)`,
      [metric.id, metric.cityId, metric.category, metric.recentBookings,
        metric.expectedBookings, metric.windowDays, metric.source]
    );
  }
}

function vehicleValues(vehicle) {
  return [
    vehicle.id, vehicle.name, vehicle.brand, vehicle.model, vehicle.typeId, vehicle.category || "FOUR_WHEELER",
    vehicle.subcategory || vehicle.type || "CAR", vehicle.cityId, vehicle.locationId, vehicle.fuelType || "PETROL",
    vehicle.transmission || "MANUAL", vehicle.seatingCapacity || 5, vehicle.description || "",
    json(vehicle.specifications), json(vehicle.features), vehicle.imageUrl || "", vehicle.fallbackImageUrl || vehicle.imageUrl || "",
    vehicle.baseDailyRate, vehicle.baseHourlyRate, vehicle.minDailyRate, vehicle.maxDailyRate,
    vehicle.status || "ACTIVE", vehicle.maintenanceStatus || "OK"
  ];
}

export async function initializeMysqlStore() {
  for (const name of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
    if (!process.env[name]?.trim()) throw new Error(`${name} must be set to use MySQL storage`);
  }
  const baseline = initialDemoStore();
  await pool.query("SELECT 1");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[{ vehicleCount }]] = await connection.query("SELECT COUNT(*) AS vehicleCount FROM vehicles");
    if (Number(vehicleCount) === 0) await seedCatalogue(baseline, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [
    [users], [cities], [locations], [types], [vehicles], [settings], [metrics],
    [peaks], [quotes], [reservations], [snapshots], [payments], [maintenance],
    [history], [auditLogs]
  ] = await Promise.all([
    pool.query("SELECT * FROM users"),
    pool.query("SELECT * FROM cities WHERE active=TRUE"),
    pool.query("SELECT l.*,c.name AS city_name FROM rental_locations l JOIN cities c ON c.id=l.city_id WHERE l.active=TRUE"),
    pool.query("SELECT * FROM vehicle_types"),
    pool.query("SELECT * FROM vehicles"),
    pool.query("SELECT * FROM pricing_settings WHERE id=1"),
    pool.query("SELECT * FROM demand_metrics"),
    pool.query("SELECT * FROM peak_dates"),
    pool.query("SELECT * FROM price_quotes ORDER BY created_at DESC"),
    pool.query("SELECT * FROM reservations ORDER BY created_at DESC"),
    pool.query("SELECT * FROM booking_price_snapshots"),
    pool.query("SELECT * FROM payments"),
    pool.query("SELECT * FROM maintenance_periods"),
    pool.query("SELECT * FROM price_history ORDER BY recorded_at DESC LIMIT 200"),
    pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500")
  ]);
  if (!vehicles.length) throw new Error("MySQL catalogue seeding completed without vehicles; check schema permissions.");

  const cityNames = new Map(cities.map((city) => [city.id, city.name]));
  const locationNames = new Map(locations.map((location) => [location.id, location.name]));
  const baselineById = new Map(baseline.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const quoteById = new Map(quotes.map((row) => [row.id, row]));
  const snapshotByReservation = new Map(snapshots.map((row) => [row.reservation_id, row]));
  const store = {
    ...baseline,
    users: users.map((row) => ({
      id: row.id, name: row.name, email: row.email, passwordHash: row.password_hash,
      role: row.role, createdAt: iso(row.created_at)
    })),
    cities: cities.map((row) => ({ id: row.id, name: row.name, country: row.country })),
    locations: locations.map((row) => ({
      id: row.id, cityId: row.city_id, cityName: row.city_name, name: row.name, type: row.type,
      addressDescription: row.address_description, active: Boolean(row.active), demoOnly: true
    })),
    vehicleTypes: types.map((row) => ({ id: row.id, name: row.name })),
    vehicles: vehicles.map((row) => {
      const base = baselineById.get(row.id);
      return {
        ...(base || {}),
        id: row.id, name: row.name, brand: row.brand, model: row.model, typeId: row.type_id,
        type: types.find((type) => type.id === row.type_id)?.name || "CAR",
        category: row.category, pricingTier: base?.pricingTier || row.category,
        pricingTierLabel: base?.pricingTierLabel || "Vehicle",
        subcategory: row.subcategory, cityId: row.city_id, city: cityNames.get(row.city_id) || "",
        country: cities.find((city) => city.id === row.city_id)?.country || "India",
        locationId: row.location_id, locationName: locationNames.get(row.location_id) || "",
        fuelType: row.fuel_type, transmission: row.transmission, seatingCapacity: row.seating_capacity,
        description: row.description, specifications: parsedJson(row.specifications),
        features: parsedJson(row.features, []), imageUrl: row.image_url, fallbackImageUrl: row.fallback_image_url,
        baseDailyRate: Number(row.base_daily_rate), baseHourlyRate: Number(row.base_hourly_rate),
        minDailyRate: Number(row.min_daily_rate), maxDailyRate: Number(row.max_daily_rate),
        status: row.status, maintenanceStatus: row.maintenance_status, createdAt: iso(row.created_at),
        demoOnly: true
      };
    }),
    pricing: mapPricing(settings[0], baseline.pricing),
    demandMetrics: metrics.map((row) => ({
      id: row.id, cityId: row.city_id, category: row.category, recentBookings: row.recent_bookings,
      expectedBookings: row.expected_bookings, windowDays: row.window_days, source: row.source
    })),
    peakDates: peaks.map((row) => ({
      id: row.id, name: row.name, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at),
      cityId: row.city_id, locationId: row.location_id, multiplier: row.multiplier === null ? null : Number(row.multiplier),
      active: Boolean(row.active), createdAt: iso(row.created_at)
    })),
    quotes: quotes.filter((row) => users.some((user) => user.id === row.user_id)).map((row) => ({
      id: row.id, userId: row.user_id, vehicleId: row.vehicle_id, pickupAt: iso(row.pickup_at),
      returnAt: iso(row.return_at), breakdown: parsedJson(row.breakdown), final_total: Number(row.final_total),
      currency: row.currency, expires_at: iso(row.expires_at), createdAt: iso(row.created_at)
    })),
    bookings: reservations.map((row) => {
      const snapshot = snapshotByReservation.get(row.id);
      const quote = quoteById.get(row.quote_id);
      return {
        id: row.id, userId: row.user_id, vehicleId: row.vehicle_id, quoteId: row.quote_id,
        pickupAt: iso(row.pickup_at), returnAt: iso(row.return_at), status: row.status,
        total_price: Number(row.total_price), currency: row.currency, holdExpiresAt: iso(row.hold_expires_at),
        createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
        breakdown: parsedJson(snapshot?.breakdown || quote?.breakdown)
      };
    }),
    payments: payments.map((row) => ({
      id: row.id, bookingId: row.reservation_id, provider: row.provider, status: row.status,
      amount: Number(row.amount), transactionRef: row.transaction_ref, createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at)
    })),
    maintenancePeriods: maintenance.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at),
      reason: row.reason, createdAt: iso(row.created_at)
    })),
    priceHistory: history.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, vehicleName: vehicles.find((vehicle) => vehicle.id === row.vehicle_id)?.name,
      baseDailyRate: Number(row.base_daily_rate), calculatedDailyRate: Number(row.calculated_daily_rate),
      multiplier: Number(row.multiplier), reason: row.reason, createdAt: iso(row.recorded_at)
    })),
    auditLogs: auditLogs.map((row) => ({
      id: row.id, userId: row.user_id, action: row.action, entityType: row.entity_type,
      entityId: row.entity_id, details: parsedJson(row.details), createdAt: iso(row.created_at)
    }))
  };
  lastSaved = structuredClone(store);
  return store;
}

let lastSaved;
let saveQueue = Promise.resolve();

async function syncRows(current, previous, table, serializer, key = "id", deleteMissing = false, executor = pool) {
  const previousMap = new Map((previous || []).map((item) => [item[key], JSON.stringify(item)]));
  const currentIds = new Set();
  for (const row of current) {
    currentIds.add(row[key]);
    if (previousMap.get(row[key]) === JSON.stringify(row)) continue;
    await serializer(row);
  }
  if (deleteMissing && previous) {
    for (const old of previous) {
      if (!currentIds.has(old[key])) await executor.execute(`DELETE FROM ${table} WHERE ${key}=?`, [old[key]]);
    }
  }
}

async function upsertSnapshot(snapshot, previous, connection) {
  await syncRows(snapshot.users, previous.users, "users", (row) => connection.execute(
    `INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name),email=VALUES(email),password_hash=VALUES(password_hash),role=VALUES(role)`,
    [row.id, row.name, row.email, row.passwordHash, row.role, date(row.createdAt)]
  ));
  await syncRows(snapshot.vehicles, previous.vehicles, "vehicles", (row) => connection.execute(
    `INSERT INTO vehicles
     (id,name,brand,model,type_id,category,subcategory,city_id,location_id,fuel_type,transmission,seating_capacity,
      description,specifications,features,image_url,fallback_image_url,base_daily_rate,base_hourly_rate,min_daily_rate,
      max_daily_rate,status,maintenance_status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name),brand=VALUES(brand),model=VALUES(model),type_id=VALUES(type_id),
      category=VALUES(category),subcategory=VALUES(subcategory),city_id=VALUES(city_id),location_id=VALUES(location_id),
      fuel_type=VALUES(fuel_type),transmission=VALUES(transmission),seating_capacity=VALUES(seating_capacity),
      description=VALUES(description),specifications=VALUES(specifications),features=VALUES(features),
      image_url=VALUES(image_url),fallback_image_url=VALUES(fallback_image_url),base_daily_rate=VALUES(base_daily_rate),
      base_hourly_rate=VALUES(base_hourly_rate),min_daily_rate=VALUES(min_daily_rate),max_daily_rate=VALUES(max_daily_rate),
      status=VALUES(status),maintenance_status=VALUES(maintenance_status)`,
    [...vehicleValues(row), date(row.createdAt)]
  ));

  const p = snapshot.pricing;
  if (JSON.stringify(p) !== JSON.stringify(previous.pricing)) {
    await connection.execute(
      `INSERT INTO pricing_settings
       (id,rule_version,duration_discount_percent,early_booking_discount_percent,early_booking_minimum_days,booking_fee,
        tax_percent,demand_low_score,demand_normal_score,demand_elevated_score,low_demand_multiplier,
        normal_demand_multiplier,elevated_demand_multiplier,high_demand_multiplier,availability_low_ratio,
        availability_medium_ratio,low_availability_multiplier,medium_availability_multiplier,peak_multiplier)
       VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE rule_version=VALUES(rule_version),duration_discount_percent=VALUES(duration_discount_percent),
        early_booking_discount_percent=VALUES(early_booking_discount_percent),early_booking_minimum_days=VALUES(early_booking_minimum_days),
        booking_fee=VALUES(booking_fee),tax_percent=VALUES(tax_percent),demand_low_score=VALUES(demand_low_score),
        demand_normal_score=VALUES(demand_normal_score),demand_elevated_score=VALUES(demand_elevated_score),
        low_demand_multiplier=VALUES(low_demand_multiplier),normal_demand_multiplier=VALUES(normal_demand_multiplier),
        elevated_demand_multiplier=VALUES(elevated_demand_multiplier),high_demand_multiplier=VALUES(high_demand_multiplier),
        availability_low_ratio=VALUES(availability_low_ratio),availability_medium_ratio=VALUES(availability_medium_ratio),
        low_availability_multiplier=VALUES(low_availability_multiplier),medium_availability_multiplier=VALUES(medium_availability_multiplier),
        peak_multiplier=VALUES(peak_multiplier)`,
      [p.ruleVersion, p.durationDiscountPercent, p.earlyBookingDiscountPercent, p.earlyBookingMinimumDays, p.bookingFee,
        p.taxPercent, p.demandLowScore, p.demandNormalScore, p.demandElevatedScore, p.lowDemandMultiplier,
        p.normalDemandMultiplier, p.demandElevatedMultiplier, p.highDemandMultiplier, p.availabilityLowRatio,
        p.availabilityMediumRatio, p.lowAvailabilityMultiplier ?? p.availabilityHighMultiplier,
        p.availabilityMediumMultiplier, p.peakMultiplier ?? 1.1]
    );
  }

  await syncRows(snapshot.demandMetrics, previous.demandMetrics, "demand_metrics", (row) => connection.execute(
    `INSERT INTO demand_metrics (id,city_id,category,recent_bookings,expected_bookings,window_days,source)
     VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE recent_bookings=VALUES(recent_bookings),
      expected_bookings=VALUES(expected_bookings),window_days=VALUES(window_days),source=VALUES(source)`,
    [row.id, row.cityId, row.category, row.recentBookings, row.expectedBookings, row.windowDays, row.source]
  ));
  await syncRows(snapshot.peakDates, previous.peakDates, "peak_dates", (row) => connection.execute(
    `INSERT INTO peak_dates (id,name,starts_at,ends_at,city_id,location_id,multiplier,active,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),starts_at=VALUES(starts_at),
      ends_at=VALUES(ends_at),city_id=VALUES(city_id),location_id=VALUES(location_id),multiplier=VALUES(multiplier),
      active=VALUES(active)`,
    [row.id, row.name, date(row.startsAt), date(row.endsAt), row.cityId || null, row.locationId || null,
      row.multiplier ?? null, row.active, row.createdBy || null, date(row.createdAt)]
  ));
  await syncRows(snapshot.quotes, previous.quotes, "price_quotes", async (row) => {
    const user = snapshot.users.find((item) => item.id === row.userId);
    if (!user) throw new Error(`Cannot save quote ${row.id}: its user is missing from the application store.`);
    await connection.execute(
      `INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name),email=VALUES(email),password_hash=VALUES(password_hash),role=VALUES(role)`,
      [user.id, user.name, user.email, user.passwordHash, user.role, date(user.createdAt)]
    );
    await connection.execute(
      `INSERT INTO price_quotes (id,user_id,vehicle_id,pickup_at,return_at,breakdown,final_total,currency,expires_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE breakdown=VALUES(breakdown),final_total=VALUES(final_total),
        expires_at=VALUES(expires_at)`,
      [row.id, row.userId, row.vehicleId, date(row.pickupAt), date(row.returnAt), json(row.breakdown),
        row.final_total, row.currency || "INR", date(row.expires_at), date(row.createdAt || row.created_at)]
    );
  });
  await syncRows(snapshot.bookings, previous.bookings, "reservations", async (row) => {
    await connection.execute(
      `INSERT INTO reservations       (id,user_id,vehicle_id,quote_id,pickup_at,return_at,status,total_price,currency,hold_expires_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),total_price=VALUES(total_price),
        hold_expires_at=VALUES(hold_expires_at),updated_at=VALUES(updated_at)`,
      [row.id, row.userId, row.vehicleId, row.quoteId || null, date(row.pickupAt), date(row.returnAt),
       row.status, row.total_price, row.currency || "INR", date(row.holdExpiresAt), date(row.createdAt), date(row.updatedAt)]
    );
    if (row.quoteId) {
      await connection.execute(
        `INSERT INTO booking_price_snapshots (id,reservation_id,quote_id,breakdown,final_total,currency)
         VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE breakdown=VALUES(breakdown),final_total=VALUES(final_total)`,
        [row.id, row.id, row.quoteId, json(row.breakdown), row.total_price, row.currency || "INR"]
      );
    }
  });
  await syncRows(snapshot.payments, previous.payments, "payments", (row) => connection.execute(
    `INSERT INTO payments (id,reservation_id,provider,status,amount,transaction_ref,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),amount=VALUES(amount),
      transaction_ref=VALUES(transaction_ref),updated_at=VALUES(updated_at)`,
    [row.id, row.bookingId, row.provider, row.status, row.amount, row.transactionRef || null,
      date(row.createdAt), date(row.updatedAt)]
  ));
  await syncRows(snapshot.maintenancePeriods, previous.maintenancePeriods, "maintenance_periods", (row) => connection.execute(
    `INSERT INTO maintenance_periods (id,vehicle_id,starts_at,ends_at,reason,created_at)
     VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE starts_at=VALUES(starts_at),ends_at=VALUES(ends_at),reason=VALUES(reason)`,
    [row.id, row.vehicleId, date(row.startsAt), date(row.endsAt), row.reason || null, date(row.createdAt)]
  ), "id", true, connection);
  await syncRows(snapshot.priceHistory.slice(0, 200), previous.priceHistory, "price_history", (row) => connection.execute(
    `INSERT INTO price_history (id,vehicle_id,base_daily_rate,calculated_daily_rate,multiplier,reason,recorded_at)
     VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE calculated_daily_rate=VALUES(calculated_daily_rate),
      multiplier=VALUES(multiplier),reason=VALUES(reason)`,
    [row.id, row.vehicleId, row.baseDailyRate ?? row.breakdown?.baseDailyRate ?? 0,
      row.calculatedDailyRate ?? row.final_total ?? 0, row.multiplier ?? 1, row.reason || "Quote",
      date(row.createdAt || row.created_at || row.recordedAt)]
  ));
  await syncRows(snapshot.auditLogs.slice(0, 500), previous.auditLogs, "audit_logs", (row) => connection.execute(
    `INSERT INTO audit_logs (id,user_id,action,entity_type,entity_id,details,created_at)
     VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE details=VALUES(details)`,
    [row.id, row.userId || null, row.action, row.entityType, row.entityId, json(row.details), date(row.createdAt)]
  ));
}

export function persistMysql(store) {
  const snapshot = structuredClone(store);
  const operation = saveQueue.catch(() => {}).then(async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await upsertSnapshot(snapshot, lastSaved, connection);
      await connection.commit();
      lastSaved = snapshot;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
  saveQueue = operation;
  return operation;
}

export async function createMysqlReservation({ booking, payment }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM vehicles WHERE id=? FOR UPDATE", [booking.vehicleId]);
    const [conflicts] = await connection.execute(
      `SELECT id FROM reservations
       WHERE vehicle_id=? AND status IN ('CONFIRMED','PENDING')
         AND (status='CONFIRMED' OR hold_expires_at > UTC_TIMESTAMP(3))
         AND pickup_at < ? AND return_at > ? FOR UPDATE`,
      [booking.vehicleId, date(booking.returnAt), date(booking.pickupAt)]
    );
    if (conflicts.length) {
      const error = new Error("Vehicle is not available for those dates");
      error.status = 409;
      throw error;
    }
    const [maintenance] = await connection.execute(
      `SELECT id FROM maintenance_periods
       WHERE vehicle_id=? AND starts_at < ? AND ends_at > ? FOR UPDATE`,
      [booking.vehicleId, date(booking.returnAt), date(booking.pickupAt)]
    );
    if (maintenance.length) {
      const error = new Error("Vehicle has a maintenance block during the selected period");
      error.status = 409;
      throw error;
    }
    await connection.execute(
      `INSERT INTO reservations
       (id,user_id,vehicle_id,quote_id,pickup_at,return_at,status,total_price,currency,hold_expires_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [booking.id, booking.userId, booking.vehicleId, booking.quoteId, date(booking.pickupAt), date(booking.returnAt),
        booking.status, booking.total_price, booking.currency, date(booking.holdExpiresAt), date(booking.createdAt)]
    );
    await connection.execute(
      `INSERT INTO booking_price_snapshots (id,reservation_id,quote_id,breakdown,final_total,currency)
       VALUES (?,?,?,?,?,?)`,
      [booking.id, booking.id, booking.quoteId, json(booking.breakdown), booking.total_price, booking.currency]
    );
    await connection.execute(
      "INSERT INTO payments (id,reservation_id,provider,status,amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      [payment.id, payment.bookingId, payment.provider, payment.status, payment.amount, new Date(), new Date()]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
