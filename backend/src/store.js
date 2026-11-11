import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { initialDemoStore } from "./data/catalogue.js";

const file = resolve(process.env.STORE_FILE || resolve(dirname(fileURLToPath(import.meta.url)), "../data/store.json"));

function normalizeStore(existing) {
  const baseline = initialDemoStore();
  if (!existing) return baseline;
  const vehicles = [...baseline.vehicles];
  const oldToNewVehicleId = new Map();
  for (const oldVehicle of existing.vehicles || []) {
    const matchingModels = vehicles.filter((vehicle) =>
      vehicle.brand.toLowerCase() === String(oldVehicle.brand).toLowerCase() &&
      (vehicle.model.toLowerCase().startsWith(String(oldVehicle.model).toLowerCase()) ||
        String(oldVehicle.model).toLowerCase().startsWith(vehicle.model.toLowerCase())));
    const oldCityId = oldVehicle.cityId || baseline.cities.find((city) =>
      city.name.toLowerCase() === String(oldVehicle.city || "").toLowerCase())?.id;
    const match = matchingModels.find((vehicle) => vehicle.cityId === oldCityId) || matchingModels[0];
    if (match) {
      oldToNewVehicleId.set(oldVehicle.id, match.id);
      const oldDailyRate = Number(oldVehicle.baseDailyRate ?? oldVehicle.base_daily_rate);
      const retainExistingRate = Number.isFinite(oldDailyRate) &&
        oldDailyRate >= match.minDailyRate && oldDailyRate <= match.maxDailyRate;
      Object.assign(match, {
        baseDailyRate: retainExistingRate ? oldDailyRate : match.baseDailyRate,
        baseHourlyRate: retainExistingRate
          ? Number(oldVehicle.baseHourlyRate ?? oldVehicle.base_hourly_rate ?? match.baseHourlyRate)
          : match.baseHourlyRate
      });
    } else {
      const location = baseline.locations.find((item) => item.cityId === "hyderabad");
      const type = baseline.vehicleTypes.find((item) => item.name === (oldVehicle.type || "CAR")) || baseline.vehicleTypes[0];
      const legacy = {
        ...oldVehicle,
        typeId: type.id,
        type: type.name,
        category: type.name === "CAR" ? "FOUR_WHEELER" : "TWO_WHEELER",
        subcategory: type.name,
        cityId: location.cityId,
        city: location.cityName,
        locationId: location.id,
        locationName: location.name,
        fuelType: oldVehicle.fuelType || "PETROL",
        transmission: oldVehicle.transmission || "MANUAL",
        seatingCapacity: oldVehicle.seatingCapacity || 5,
        features: oldVehicle.features || [],
        specifications: oldVehicle.specifications || {},
        fallbackImageUrl: oldVehicle.imageUrl || oldVehicle.image_url,
        imageUrl: oldVehicle.imageUrl || oldVehicle.image_url,
        baseDailyRate: Number(oldVehicle.baseDailyRate ?? oldVehicle.base_daily_rate),
        baseHourlyRate: Number(oldVehicle.baseHourlyRate ?? oldVehicle.base_hourly_rate),
        minDailyRate: Number(oldVehicle.minDailyRate ?? oldVehicle.min_daily_rate),
        maxDailyRate: Number(oldVehicle.maxDailyRate ?? oldVehicle.max_daily_rate),
        demoOnly: true
      };
      vehicles.push(legacy);
      oldToNewVehicleId.set(oldVehicle.id, legacy.id);
    }
  }
  return {
    ...baseline,
    ...existing,
    cities: baseline.cities,
    locations: baseline.locations,
    vehicleTypes: baseline.vehicleTypes,
    vehicles,
    pricing: { ...baseline.pricing, ...existing.pricing },
    demandMetrics: existing.demandMetrics || baseline.demandMetrics,
    peakDates: existing.peakDates || [],
    maintenancePeriods: existing.maintenancePeriods || [],
    quotes: (existing.quotes || []).map((quote) => ({
      ...quote,
      vehicleId: oldToNewVehicleId.get(quote.vehicleId) || quote.vehicleId
    })),
    bookings: (existing.bookings || []).map((booking) => ({
      ...booking,
      vehicleId: oldToNewVehicleId.get(booking.vehicleId) || booking.vehicleId
    })),
    payments: existing.payments || [],
    priceHistory: existing.priceHistory || [],
    auditLogs: existing.auditLogs || []
  };
}

mkdirSync(dirname(file), { recursive: true });
const useMysql = Boolean(process.env.DB_HOST && !process.env.STORE_FILE);
export let databaseType = useMysql ? "mysql" : "local-file-store";
export let store;
let persistStore;
let createReservationStore;

if (useMysql) {
  const database = await import("./mysqlStore.js");
  store = await database.initializeMysqlStore();
  persistStore = () => database.persistMysql(store);
  createReservationStore = database.createMysqlReservation;
} else {
  const initialStore = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  store = normalizeStore(initialStore);
  if (!initialStore) writeFileSync(file, JSON.stringify(store, null, 2));
  persistStore = () => {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(store, null, 2));
    renameSync(temporary, file);
  };
  createReservationStore = null;
}

export async function persist() {
  return persistStore();
}

export async function createReservation(booking, payment) {
  if (!createReservationStore) return false;
  await createReservationStore({ booking, payment });
  return true;
}

export async function shutdownStore() {
  if (useMysql) {
    const { pool } = await import("./mysqlStore.js");
    await pool.end();
  }
}
export function newId() {
  return randomUUID();
}
