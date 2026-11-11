const roundPaise = (amount) => {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

const numericInputs = [
  "baseDailyRate", "baseHourlyRate", "demandMultiplier", "availabilityMultiplier",
  "peakMultiplier", "durationDiscountPercent", "earlyBookingDiscountPercent",
  "earlyBookingMinimumDays", "daysInAdvance", "bookingFee", "taxPercent",
  "minimumDailyRate", "maximumDailyRate"
];

export function calculatePrice(input) {
  const neutralMultipliers = new Set(["demandMultiplier", "availabilityMultiplier", "peakMultiplier"]);
  const values = Object.fromEntries(numericInputs.map((key) => [
    key,
    Number(input[key] ?? (neutralMultipliers.has(key) ? 1 : 0))
  ]));
  const pickup = new Date(input.pickupAt);
  const dropoff = new Date(input.returnAt);
  if (!Number.isFinite(pickup.getTime()) || !Number.isFinite(dropoff.getTime()) || dropoff <= pickup) {
    throw new Error("Return time must be after a valid pickup time");
  }
  if (!numericInputs.every((key) => Number.isFinite(values[key]))) {
    throw new Error("Pricing values must be finite numbers");
  }
  const {
    baseDailyRate: baseDaily,
    baseHourlyRate: baseHourly,
    demandMultiplier,
    availabilityMultiplier,
    peakMultiplier,
    durationDiscountPercent,
    earlyBookingDiscountPercent,
    earlyBookingMinimumDays,
    daysInAdvance,
    bookingFee,
    taxPercent,
    minimumDailyRate,
    maximumDailyRate
  } = values;
  if (baseDaily < 0 || baseHourly < 0 || minimumDailyRate < 0 ||
      maximumDailyRate < minimumDailyRate || bookingFee < 0 ||
      [demandMultiplier, availabilityMultiplier, peakMultiplier].some((value) => value <= 0)) {
    throw new Error("Pricing rule values are invalid");
  }
  if (durationDiscountPercent < 0 || durationDiscountPercent > 100 ||
      earlyBookingDiscountPercent < 0 || earlyBookingDiscountPercent > 100 ||
      taxPercent < 0 || taxPercent > 100) {
    throw new Error("Discounts and tax must be between 0 and 100 percent");
  }

  const rentalHours = Math.ceil((dropoff - pickup) / (60 * 60 * 1000));
  const rentalDays = Math.ceil(rentalHours / 24);
  const hourly = rentalHours < 24;
  const baseUnitRate = hourly ? baseHourly : baseDaily;
  const floor = hourly ? minimumDailyRate / 24 : minimumDailyRate;
  const ceiling = hourly ? maximumDailyRate / 24 : maximumDailyRate;
  const units = hourly ? rentalHours : rentalDays;
  const baseRentalAmount = roundPaise(baseUnitRate * units);

  const demandAmount = roundPaise(baseRentalAmount * (demandMultiplier - 1));
  const afterDemand = roundPaise(baseRentalAmount + demandAmount);
  const availabilityAmount = roundPaise(afterDemand * (availabilityMultiplier - 1));
  const afterAvailability = roundPaise(afterDemand + availabilityAmount);
  const peakAmount = roundPaise(afterAvailability * (peakMultiplier - 1));
  const beforePriceLimit = roundPaise(afterAvailability + peakAmount);

  const rawUnitRate = beforePriceLimit / units;
  const boundedUnitRate = Math.min(ceiling, Math.max(floor, rawUnitRate));
  const priceLimitAdjustment = roundPaise((boundedUnitRate - rawUnitRate) * units);
  const adjustedRentalAmount = roundPaise(boundedUnitRate * units);
  const durationPercent = !hourly && rentalDays >= 3 ? durationDiscountPercent : 0;
  const durationDiscount = roundPaise(adjustedRentalAmount * durationPercent / 100);
  const afterDuration = roundPaise(adjustedRentalAmount - durationDiscount);
  const earlyEligible = daysInAdvance >= earlyBookingMinimumDays && earlyBookingDiscountPercent > 0;
  const earlyDiscount = earlyEligible ? roundPaise(afterDuration * earlyBookingDiscountPercent / 100) : 0;
  const rentalAfterDiscounts = roundPaise(afterDuration - earlyDiscount);
  const fee = roundPaise(bookingFee);
  const taxableAmount = roundPaise(rentalAfterDiscounts + fee);
  const taxAmount = roundPaise(taxableAmount * taxPercent / 100);
  const total = roundPaise(taxableAmount + taxAmount);
  const baseAmount = roundPaise(baseDaily * (hourly ? units / 24 : units));
  const activePeakRules = input.applicablePeakRules || [];
  const explanations = [
    `Bill ${units} ${hourly ? "hour(s)" : "24-hour day block(s)"}, rounding partial blocks up.`,
    `Demand multiplier ×${demandMultiplier}; availability multiplier ×${availabilityMultiplier}.`,
    activePeakRules.length
      ? `Peak pricing applied for ${activePeakRules.join(", ")}.`
      : peakMultiplier !== 1 ? `Peak multiplier ×${peakMultiplier}.` : "No peak period applies.",
    boundedUnitRate !== rawUnitRate
      ? `The permitted ${hourly ? "hourly-equivalent" : "daily"} rate floor/ceiling changed the unit rate.`
      : "No rate floor or ceiling adjustment was needed.",
    earlyEligible ? `Early-booking discount applied at ${earlyBookingDiscountPercent}%.` : "No early-booking discount applies.",
    `A ${taxPercent}% demonstration tax is applied to discounted rental amount plus booking fee.`
  ];

  return {
    rentalDays,
    rentalHours,
    billableUnits: units,
    rateUnit: hourly ? "hour" : "day",
    baseDailyRate: roundPaise(baseDaily),
    baseUnitRate: roundPaise(baseUnitRate),
    baseRentalAmount,
    baseTotal: baseRentalAmount,
    demandScore: input.demandScore ?? null,
    demandRecentBookings: input.demandRecentBookings ?? null,
    demandExpectedBookings: input.demandExpectedBookings ?? null,
    demandAdjustment: demandAmount,
    demandMultiplier,
    availabilityRatio: input.availabilityRatio ?? null,
    availableComparableVehicles: input.availableComparableVehicles ?? null,
    comparableVehicleCount: input.comparableVehicleCount ?? null,
    availabilityAdjustment: availabilityAmount,
    availabilityMultiplier,
    peakAdjustment: peakAmount,
    peakMultiplier,
    applicablePeakRules: activePeakRules,
    priceLimitAdjustment,
    unitRate: roundPaise(boundedUnitRate),
    durationDiscountPercent: durationPercent,
    durationAdjustment: durationDiscount === 0 ? 0 : -durationDiscount,
    daysInAdvance: Number.isFinite(daysInAdvance) ? daysInAdvance : null,
    earlyBookingDiscountPercent: earlyEligible ? earlyBookingDiscountPercent : 0,
    earlyBookingAdjustment: earlyDiscount === 0 ? 0 : -earlyDiscount,
    feeAmount: fee,
    subtotal: taxableAmount,
    taxPercent,
    taxAmount,
    total,
    currency: input.currency || "INR",
    ruleVersion: input.ruleVersion || "demo-v2",
    explanation: explanations
  };
}

export function demandForCounts(recentBookings, expectedBookings, pricing) {
  const recent = Number(recentBookings);
  const expected = Number(expectedBookings);
  if (!Number.isFinite(recent) || recent < 0 || !Number.isFinite(expected) || expected <= 0) {
    return { score: null, level: "NORMAL", multiplier: Number(pricing.normalDemandMultiplier ?? 1), sufficientData: false };
  }
  const score = Math.round(recent / expected * 100);
  if (score < Number(pricing.demandLowScore ?? 50)) {
    return { score, level: "LOW", multiplier: Number(pricing.lowDemandMultiplier ?? 0.9), sufficientData: true };
  }
  if (score <= Number(pricing.demandNormalScore ?? 100)) {
    return { score, level: "NORMAL", multiplier: Number(pricing.normalDemandMultiplier ?? 1), sufficientData: true };
  }
  if (score <= Number(pricing.demandElevatedScore ?? 150)) {
    return { score, level: "ELEVATED", multiplier: Number(pricing.demandElevatedMultiplier ?? 1.1), sufficientData: true };
  }
  return { score, level: "HIGH", multiplier: Number(pricing.highDemandMultiplier ?? 1.2), sufficientData: true };
}

export function availabilityForCounts(available, total, pricing) {
  const denominator = Number(total);
  const numerator = Number(available);
  if (!Number.isFinite(denominator) || denominator <= 0 || !Number.isFinite(numerator) || numerator < 0) {
    return {
      ratio: null,
      level: "UNKNOWN",
      multiplier: Number(pricing.availabilityNormalMultiplier ?? 1),
      available: 0,
      total: 0
    };
  }
  const boundedAvailable = Math.min(denominator, numerator);
  const ratio = boundedAvailable / denominator;
  const low = Number(pricing.availabilityLowRatio ?? 0.2);
  const medium = Number(pricing.availabilityMediumRatio ?? 0.5);
  return {
    ratio: Number(ratio.toFixed(4)),
    level: ratio <= low ? "LOW" : ratio <= medium ? "MEDIUM" : "HIGH",
    multiplier: ratio <= low
      ? Number(pricing.availabilityHighMultiplier ?? pricing.lowAvailabilityMultiplier ?? 1.15)
      : ratio <= medium
        ? Number(pricing.availabilityMediumMultiplier ?? 1.05)
        : Number(pricing.availabilityNormalMultiplier ?? 1),
    available: boundedAvailable,
    total: denominator
  };
}
