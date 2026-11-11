import test from "node:test";
import assert from "node:assert/strict";
import { availabilityForCounts, calculatePrice, demandForCounts } from "../src/pricing.js";

test("calculates ceiling days, rule multipliers, discount, and clamps daily rate", () => {
  const result = calculatePrice({
    baseDailyRate: 1000,
    baseHourlyRate: 100,
    pickupAt: "2026-11-01T10:00:00+05:30",
    returnAt: "2026-11-04T10:00:00+05:30",
    demandMultiplier: 1.2,
    availabilityMultiplier: 1,
    peakMultiplier: 1.1,
    durationDiscountPercent: 10,
    minimumDailyRate: 500,
    maximumDailyRate: 1200
  });
  assert.equal(result.rentalDays, 3);
  assert.equal(result.unitRate, 1200);
  assert.equal(result.total, 3240);
});

test("rejects invalid rental intervals", () => {
  assert.throws(() => calculatePrice({
    baseDailyRate: 100, pickupAt: "2026-01-02T00:00:00Z", returnAt: "2026-01-01T00:00:00Z",
    minimumDailyRate: 10, maximumDailyRate: 100
  }));
});

test("uses hourly rate and rounds a partial hour up", () => {
  const result = calculatePrice({
    baseDailyRate: 1200,
    baseHourlyRate: 100,
    pickupAt: "2026-11-01T10:00:00Z",
    returnAt: "2026-11-01T11:01:00Z",
    minimumDailyRate: 240,
    maximumDailyRate: 2400
  });
  assert.equal(result.rateUnit, "hour");
  assert.equal(result.rentalHours, 2);
  assert.equal(result.total, 200);
});

test("does not apply long-rental discount to hourly bookings", () => {
  const result = calculatePrice({
    baseDailyRate: 1200,
    baseHourlyRate: 100,
    pickupAt: "2026-11-01T10:00:00Z",
    returnAt: "2026-11-01T12:00:00Z",
    durationDiscountPercent: 20,
    minimumDailyRate: 240,
    maximumDailyRate: 2400
  });
  assert.equal(result.durationAdjustment, 0);
  assert.equal(result.total, 200);
});

test("applies minimum and maximum permitted daily prices", () => {
  const minimum = calculatePrice({
    baseDailyRate: 100,
    baseHourlyRate: 20,
    pickupAt: "2026-11-01T10:00:00Z",
    returnAt: "2026-11-03T10:00:00Z",
    demandMultiplier: 0.5,
    minimumDailyRate: 500,
    maximumDailyRate: 1000
  });
  const maximum = calculatePrice({
    baseDailyRate: 1000,
    baseHourlyRate: 20,
    pickupAt: "2026-11-01T10:00:00Z",
    returnAt: "2026-11-03T10:00:00Z",
    demandMultiplier: 2,
    minimumDailyRate: 500,
    maximumDailyRate: 1200
  });
  assert.equal(minimum.unitRate, 500);
  assert.equal(maximum.unitRate, 1200);
});

test("adds configured tax to the discounted total", () => {
  const result = calculatePrice({
    baseDailyRate: 1200,
    baseHourlyRate: 100,
    pickupAt: "2026-11-01T10:00:00Z",
    returnAt: "2026-11-01T12:00:00Z",
    taxPercent: 5,
    minimumDailyRate: 240,
    maximumDailyRate: 2400
  });
  assert.equal(result.subtotal, 200);
  assert.equal(result.taxAmount, 10);
  assert.equal(result.total, 210);
});

test("classifies demand and comparable availability by configured ratios", () => {
  const pricing = {
    demandLowScore: 50, demandNormalScore: 100, demandElevatedScore: 150,
    lowDemandMultiplier: 0.9, normalDemandMultiplier: 1,
    demandElevatedMultiplier: 1.1, highDemandMultiplier: 1.2,
    availabilityLowRatio: 0.2, availabilityMediumRatio: 0.5,
    availabilityHighMultiplier: 1.15, availabilityMediumMultiplier: 1.05
  };
  assert.equal(demandForCounts(8, 4, pricing).level, "HIGH");
  assert.equal(demandForCounts(1, 4, pricing).multiplier, 0.9);
  assert.equal(availabilityForCounts(1, 10, pricing).level, "LOW");
  assert.equal(availabilityForCounts(4, 10, pricing).multiplier, 1.05);
});

test("itemized pricing adjustments reconcile to the total", () => {
  const result = calculatePrice({
    baseDailyRate: 1500,
    baseHourlyRate: 120,
    pickupAt: "2026-11-01T10:00:00Z",
    returnAt: "2026-11-05T10:00:00Z",
    demandMultiplier: 1.2,
    availabilityMultiplier: 1.15,
    peakMultiplier: 1.1,
    durationDiscountPercent: 10,
    earlyBookingDiscountPercent: 5,
    earlyBookingMinimumDays: 10,
    daysInAdvance: 20,
    bookingFee: 50,
    taxPercent: 5,
    minimumDailyRate: 1000,
    maximumDailyRate: 3000
  });
  const itemizedTotal = result.baseRentalAmount + result.demandAdjustment +
    result.availabilityAdjustment + result.peakAdjustment + result.priceLimitAdjustment +
    result.durationAdjustment + result.earlyBookingAdjustment + result.feeAmount + result.taxAmount;
  assert.ok(Math.abs(result.total - itemizedTotal) < 0.005);
});
