import test from "node:test";
import assert from "node:assert/strict";
import { initialDemoStore } from "../src/data/catalogue.js";

test("demo catalogue has city-linked pickup locations and a diverse fleet", () => {
  const catalogue = initialDemoStore();
  assert.equal(catalogue.cities.length, 12);
  assert.equal(catalogue.vehicles.length, 432);
  assert.ok(catalogue.locations.length >= 50);
  assert.equal(new Set(catalogue.vehicles.map((vehicle) => vehicle.id)).size, catalogue.vehicles.length);
  assert.ok(catalogue.vehicles.every((vehicle) =>
    catalogue.cities.some((city) => city.id === vehicle.cityId) &&
    catalogue.locations.some((location) => location.id === vehicle.locationId && location.cityId === vehicle.cityId)));
  assert.deepEqual(new Set(catalogue.vehicleTypes.map((type) => type.name)),
    new Set(["CAR", "BIKE", "SCOOTER", "COMMERCIAL"]));
  const modelNames = new Set(catalogue.vehicles.map((vehicle) => `${vehicle.brand} ${vehicle.model}`));
  for (const city of catalogue.cities) {
    const cityFleet = catalogue.vehicles.filter((vehicle) => vehicle.cityId === city.id);
    assert.equal(cityFleet.length, 36);
    assert.deepEqual(new Set(cityFleet.map((vehicle) => `${vehicle.brand} ${vehicle.model}`)), modelNames);
    assert.deepEqual(new Set(cityFleet.map((vehicle) => vehicle.type)), new Set(["CAR", "BIKE", "SCOOTER", "COMMERCIAL"]));
    assert.ok(new Set(cityFleet.map((vehicle) => vehicle.locationId)).size > 1);
  }
  const tierRanges = {
    BIKE: [500, 1800],
    HIGH_END_BIKE: [2000, 4000],
    CAR: [4500, 8500],
    HIGH_END_CAR: [9500, 16000],
    COMMERCIAL: [4100, 4400]
  };
  for (const vehicle of catalogue.vehicles) {
    const [minimum, maximum] = tierRanges[vehicle.pricingTier];
    assert.ok(vehicle.baseDailyRate >= minimum && vehicle.baseDailyRate <= maximum);
    assert.equal(vehicle.minDailyRate, minimum);
    assert.equal(vehicle.maxDailyRate, maximum);
  }
  assert.ok(Math.max(...catalogue.vehicles.filter((item) => item.pricingTier === "BIKE").map((item) => item.baseDailyRate)) <
    Math.min(...catalogue.vehicles.filter((item) => item.pricingTier === "HIGH_END_BIKE").map((item) => item.baseDailyRate)));
  assert.ok(Math.max(...catalogue.vehicles.filter((item) => item.pricingTier === "HIGH_END_BIKE").map((item) => item.baseDailyRate)) <
    Math.min(...catalogue.vehicles.filter((item) => item.pricingTier === "CAR").map((item) => item.baseDailyRate)));
  assert.ok(Math.max(...catalogue.vehicles.filter((item) => item.pricingTier === "CAR").map((item) => item.baseDailyRate)) <
    Math.min(...catalogue.vehicles.filter((item) => item.pricingTier === "HIGH_END_CAR").map((item) => item.baseDailyRate)));
});
