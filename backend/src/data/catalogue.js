const stableId = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

const citySpecs = [
  ["hyderabad", "Hyderabad", ["Rajiv Gandhi International Airport", "HITEC City", "Gachibowli", "Madhapur", "Kondapur", "Ameerpet", "Secunderabad Railway Station", "Banjara Hills"]],
  ["bengaluru", "Bengaluru", ["Kempegowda International Airport", "MG Road", "Indiranagar", "Whitefield", "Electronic City", "Koramangala", "Yeshwanthpur Railway Station", "Majestic Bus Station"]],
  ["chennai", "Chennai", ["Chennai International Airport", "T. Nagar", "Guindy", "Velachery", "OMR / Sholinganallur", "Anna Nagar", "Chennai Central Railway Station", "Koyambedu Bus Terminus"]],
  ["mumbai", "Mumbai", ["Chhatrapati Shivaji Maharaj International Airport", "Andheri", "Bandra", "Powai", "Lower Parel", "Dadar", "Mumbai Central", "Navi Mumbai / Vashi"]],
  ["delhi-ncr", "Delhi NCR", ["Indira Gandhi International Airport", "Connaught Place", "New Delhi Railway Station", "Dwarka", "Aerocity"]],
  ["delhi-ncr", "Delhi NCR · Gurugram service area", ["Gurugram Cyber City"]],
  ["delhi-ncr", "Delhi NCR · Noida service area", ["Noida Sector 18", "Noida Sector 62"]],
  ["pune", "Pune", ["Pune International Airport", "Hinjawadi", "Baner", "Wakad", "Viman Nagar", "Koregaon Park", "Pune Railway Station"]],
  ["kolkata", "Kolkata", ["Netaji Subhas Chandra Bose International Airport", "Salt Lake Sector V", "New Town", "Park Street", "Howrah Railway Station", "Sealdah Railway Station"]],
  ["ahmedabad", "Ahmedabad", ["Sardar Vallabhbhai Patel International Airport", "SG Highway", "Satellite", "Prahlad Nagar", "Ahmedabad Junction"]],
  ["kochi", "Kochi", ["Cochin International Airport", "Ernakulam Junction", "Kakkanad", "Edappally", "Fort Kochi", "Vyttila Mobility Hub"]],
  ["jaipur", "Jaipur", ["Jaipur International Airport", "Jaipur Junction", "Malviya Nagar", "Vaishali Nagar", "MI Road"]],
  ["coimbatore", "Coimbatore", ["Coimbatore International Airport", "Gandhipuram", "Coimbatore Junction", "Peelamedu", "RS Puram"]],
  ["visakhapatnam", "Visakhapatnam", ["Visakhapatnam Airport", "Visakhapatnam Railway Station", "MVP Colony", "Dwaraka Nagar", "Gajuwaka"]]
];

export const cities = [
  { id: "hyderabad", name: "Hyderabad", country: "India" },
  { id: "bengaluru", name: "Bengaluru", country: "India" },
  { id: "chennai", name: "Chennai", country: "India" },
  { id: "mumbai", name: "Mumbai", country: "India" },
  { id: "delhi-ncr", name: "Delhi NCR", country: "India" },
  { id: "pune", name: "Pune", country: "India" },
  { id: "kolkata", name: "Kolkata", country: "India" },
  { id: "ahmedabad", name: "Ahmedabad", country: "India" },
  { id: "kochi", name: "Kochi", country: "India" },
  { id: "jaipur", name: "Jaipur", country: "India" },
  { id: "coimbatore", name: "Coimbatore", country: "India" },
  { id: "visakhapatnam", name: "Visakhapatnam", country: "India" }
];

let nextLocationId = 1001;
export const locations = citySpecs.flatMap(([cityId, cityName, names]) =>
  names.map((name) => {
    const type = /Airport/i.test(name) ? "AIRPORT"
      : /Railway Station|Junction|Bus Terminus|Mobility Hub/i.test(name) ? "TRANSIT_HUB"
        : /Cyber City|Sector|Highway|Business|HITEC|Electronic City|Salt Lake/i.test(name) ? "BUSINESS_DISTRICT"
          : "DISTRICT";
    return {
      id: stableId(nextLocationId++),
      cityId,
      cityName: cityName.split(" · ")[0],
      name,
      type,
      addressDescription: `${name}, ${cityName.split(" · ")[0]}, India`,
      active: true,
      demoOnly: true
    };
  })
);

export const vehicleTypes = [
  { id: stableId(1), name: "CAR" },
  { id: stableId(2), name: "BIKE" },
  { id: stableId(3), name: "SCOOTER" },
  { id: stableId(4), name: "COMMERCIAL" }
];

const vehicleSpecs = [
  ["Maruti Suzuki", "Swift", "Swift", "Hatchback", "PETROL", "MANUAL", 5, 1800, "A nimble hatchback for everyday city trips.", "ABS, Air conditioning, Bluetooth"],
  ["Maruti Suzuki", "Baleno", "Baleno", "Hatchback", "PETROL", "MANUAL", 5, 1900, "A roomy hatchback for city and weekend travel.", "Air conditioning, Rear camera, Bluetooth"],
  ["Hyundai", "Grand i10 Nios", "Grand i10 Nios", "Hatchback", "PETROL", "MANUAL", 5, 1700, "Compact and comfortable for city driving.", "Air conditioning, Rear camera, Bluetooth"],
  ["Tata", "Tiago", "Tiago", "Hatchback", "PETROL", "MANUAL", 5, 1600, "A practical compact car for short breaks and commutes.", "ABS, Air conditioning, Android Auto"],
  ["Honda", "City", "City", "Sedan", "PETROL", "AUTOMATIC", 5, 3000, "A refined sedan with generous passenger space.", "Cruise control, Rear camera, Climate control"],
  ["Hyundai", "Verna", "Verna", "Sedan", "PETROL", "AUTOMATIC", 5, 3200, "A modern sedan suited to business and leisure travel.", "Sunroof, Ventilated seats, Rear camera"],
  ["Maruti Suzuki", "Dzire", "Dzire", "Sedan", "PETROL", "MANUAL", 5, 2100, "An economical sedan with room for a small family.", "Air conditioning, ABS, Boot space"],
  ["Hyundai", "Creta", "Creta", "Compact SUV", "PETROL", "AUTOMATIC", 5, 3900, "A versatile SUV for city use and weekend escapes.", "Sunroof, Rear camera, Climate control"],
  ["Kia", "Seltos", "Seltos", "Compact SUV", "DIESEL", "AUTOMATIC", 5, 4200, "A feature-rich SUV for comfortable longer journeys.", "Navigation, Rear camera, Cruise control"],
  ["Tata", "Nexon", "Nexon", "Compact SUV", "PETROL", "MANUAL", 5, 3100, "A compact SUV with a practical cabin and ride height.", "ABS, Air conditioning, Parking sensors"],
  ["Mahindra", "Scorpio-N", "Scorpio-N", "SUV", "DIESEL", "MANUAL", 7, 5200, "A spacious SUV for family and group travel.", "Four-wheel drive, Rear camera, Cruise control"],
  ["Toyota", "Innova Hycross", "Innova Hycross", "MPV", "HYBRID", "AUTOMATIC", 7, 6500, "A roomy hybrid MPV for family journeys.", "Climate control, Captain seats, Safety suite"],
  ["BMW", "3 Series", "3 Series", "Premium", "PETROL", "AUTOMATIC", 5, 11500, "A premium sedan for special occasions and business trips.", "Leather interior, Navigation, Premium audio"],
  ["Mercedes-Benz", "C-Class", "C-Class", "Premium", "PETROL", "AUTOMATIC", 5, 12500, "A refined premium sedan with a quiet cabin.", "Leather interior, Panoramic roof, Navigation"],
  ["Audi", "A4", "A4", "Premium", "PETROL", "AUTOMATIC", 5, 10500, "A comfortable executive sedan with a premium finish.", "Virtual cockpit, Leather seats, Parking sensors"],
  ["Toyota", "Camry", "Camry", "Premium Hybrid", "HYBRID", "AUTOMATIC", 5, 9800, "A comfortable hybrid sedan for longer trips.", "Hybrid drive, Leather interior, Safety suite"],
  ["Tata", "Nexon EV", "Nexon EV", "Electric SUV", "ELECTRIC", "AUTOMATIC", 5, 3600, "An electric SUV for local travel; charging plan is demo-only.", "Electric drive, Fast-charge capable, Rear camera"],
  ["MG", "ZS EV", "ZS EV", "Electric SUV", "ELECTRIC", "AUTOMATIC", 5, 5200, "A roomy electric SUV for city and regional journeys.", "Electric drive, Panoramic roof, Navigation"],
  ["Tata", "Tiago EV", "Tiago EV", "Electric Hatchback", "ELECTRIC", "AUTOMATIC", 5, 2300, "A compact electric car for everyday urban trips.", "Electric drive, Regenerative braking, Parking sensors"],
  ["Toyota", "Innova Crysta", "Innova Crysta", "MPV", "DIESEL", "MANUAL", 7, 4800, "A spacious people carrier for families and small groups.", "Three-row seating, Air conditioning, Rear camera"],
  ["Maruti Suzuki", "Ertiga", "Ertiga", "MPV", "PETROL", "MANUAL", 7, 3000, "A practical three-row vehicle for group travel.", "Three-row seating, Air conditioning, Bluetooth"],
  ["Kia", "Carens", "Carens", "MPV", "PETROL", "AUTOMATIC", 7, 3700, "A comfortable family vehicle with flexible seating.", "Three-row seating, Rear camera, Climate control"],
  ["Royal Enfield", "Classic 350", "Classic 350", "Standard Motorcycle", "PETROL", "MANUAL", 2, 1100, "A relaxed motorcycle for city rides and weekend routes.", "ABS, USB charging, Helmet included"],
  ["Bajaj", "Pulsar N250", "Pulsar N250", "Standard Motorcycle", "PETROL", "MANUAL", 2, 850, "A responsive motorcycle for daily travel.", "ABS, Digital display, Helmet included"],
  ["Yamaha", "R15 V4", "R15 V4", "Sport Motorcycle", "PETROL", "MANUAL", 2, 1200, "A lightweight sport motorcycle for confident riders.", "ABS, Traction control, Helmet included"],
  ["Royal Enfield", "Himalayan 450", "Himalayan 450", "Adventure Motorcycle", "PETROL", "MANUAL", 2, 2300, "An adventure motorcycle for planned touring routes.", "ABS, Navigation display, Helmet included"],
  ["KTM", "Duke 390", "Duke 390", "Premium Motorcycle", "PETROL", "MANUAL", 2, 2100, "A premium street motorcycle for experienced riders.", "ABS, Ride modes, Helmet included"],
  ["Kawasaki", "Versys 650", "Versys 650", "Touring Motorcycle", "PETROL", "MANUAL", 2, 3400, "A touring motorcycle for longer, pre-planned journeys.", "Touring screen, ABS, Luggage mounts"],
  ["Honda", "Activa 6G", "Activa 6G", "Scooter", "PETROL", "AUTOMATIC", 2, 600, "A familiar scooter for convenient city travel.", "Automatic, Under-seat storage, Helmet included"],
  ["TVS", "Jupiter 125", "Jupiter 125", "Scooter", "PETROL", "AUTOMATIC", 2, 650, "A comfortable scooter with useful storage.", "Automatic, USB charging, Helmet included"],
  ["Suzuki", "Access 125", "Access 125", "Scooter", "PETROL", "AUTOMATIC", 2, 700, "A lightweight scooter for short local trips.", "Automatic, Under-seat storage, Helmet included"],
  ["Ather", "450X", "450X", "Electric Scooter", "ELECTRIC", "AUTOMATIC", 2, 900, "An electric scooter; charging access is demonstration-only.", "Electric drive, Navigation, Regenerative braking"],
  ["TVS", "iQube", "iQube", "Electric Scooter", "ELECTRIC", "AUTOMATIC", 2, 800, "A quiet electric scooter for urban journeys.", "Electric drive, Smart display, Regenerative braking"],
  ["Maruti Suzuki", "Eeco", "Eeco", "Passenger Van", "PETROL", "MANUAL", 7, 2400, "A practical van for small group transport.", "Flexible seating, Large cabin, Air conditioning"],
  ["Tata", "Ace Gold", "Ace Gold", "Mini Truck", "DIESEL", "MANUAL", 2, 1900, "A light commercial vehicle for permitted local cargo use.", "Cargo bed, Commercial-use demo, Manual transmission"],
  ["Mahindra", "Bolero Pik-Up", "Bolero Pik-Up", "Pickup Truck", "DIESEL", "MANUAL", 2, 2800, "A pickup for permitted commercial-use demonstrations.", "Cargo bed, Commercial-use demo, Manual transmission"]
];

const imageByCategory = {
  CAR: "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1000&q=80",
  BIKE: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1000&q=80",
  SCOOTER: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1000&q=80",
  COMMERCIAL: "https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1000&q=80"
};
const pricingBands = {
  BIKE: { label: "Bike", minimum: 500, maximum: 1800 },
  HIGH_END_BIKE: { label: "High-end bike", minimum: 2000, maximum: 4000 },
  CAR: { label: "Car", minimum: 4500, maximum: 8500 },
  HIGH_END_CAR: { label: "High-end car", minimum: 9500, maximum: 16000 },
  COMMERCIAL: { label: "Commercial", minimum: 4100, maximum: 4400 }
};
const commercialBaseRates = vehicleSpecs
  .filter((spec) => /Truck|Van|Pickup/.test(spec[3]))
  .map((spec) => spec[7]);
const commercialRateRange = {
  minimum: Math.min(...commercialBaseRates),
  maximum: Math.max(...commercialBaseRates)
};
const locationsByCity = new Map();
for (const location of locations) {
  const list = locationsByCity.get(location.cityId) || [];
  list.push(location);
  locationsByCity.set(location.cityId, list);
}

export const catalogueVehicles = cities.flatMap((city, cityIndex) => {
  const cityLocations = locationsByCity.get(city.id);
  return vehicleSpecs.map((spec, vehicleIndex) => {
    const [brand, model, name, subcategory, fuelType, transmission, seats, baseDailyRate, description, features] = spec;
    const vehicleType = subcategory.includes("Motorcycle") ? "BIKE"
      : subcategory.includes("Scooter") ? "SCOOTER"
        : subcategory.includes("Truck") || subcategory.includes("Van") || subcategory.includes("Pickup") ? "COMMERCIAL" : "CAR";
    const pricingTier = vehicleType === "BIKE"
      ? /Premium|Adventure|Touring/.test(subcategory) ? "HIGH_END_BIKE" : "BIKE"
      : vehicleType === "SCOOTER" ? "BIKE"
        : vehicleType === "CAR"
          ? subcategory.includes("Premium") ? "HIGH_END_CAR" : "CAR"
          : "COMMERCIAL";
    const location = cityLocations[(vehicleIndex + cityIndex) % cityLocations.length];
    const band = pricingBands[pricingTier];
    const adjustedDailyRate = !band ? baseDailyRate
      : pricingTier === "COMMERCIAL"
        ? Math.round((band.minimum + (baseDailyRate - commercialRateRange.minimum) /
          (commercialRateRange.maximum - commercialRateRange.minimum) * (band.maximum - band.minimum)) / 100) * 100
        : Math.min(band.maximum, Math.max(band.minimum, baseDailyRate));
    const minimumRate = band?.minimum ?? Math.round(adjustedDailyRate * 0.75 / 50) * 50;
    const maximumRate = band?.maximum ?? Math.round(adjustedDailyRate * 1.8 / 50) * 50;
    return {
      id: stableId(2001 + cityIndex * vehicleSpecs.length + vehicleIndex),
      name,
      brand,
      model,
      typeId: vehicleTypes.find((type) => type.name === vehicleType).id,
      type: vehicleType,
      category: subcategory.includes("Motorcycle") ? "TWO_WHEELER"
        : subcategory.includes("Scooter") ? "TWO_WHEELER"
          : vehicleType === "COMMERCIAL" ? "COMMERCIAL" : "FOUR_WHEELER",
      pricingTier,
      pricingTierLabel: band?.label ?? "Commercial",
      subcategory,
      fuelType,
      transmission,
      seatingCapacity: seats,
      typeIdCategory: vehicleType,
      locationId: location.id,
      locationName: location.name,
      cityId: city.id,
      city: city.name,
      country: city.country,
      description,
      features: features.split(", "),
      specifications: { fuelType, transmission, seatingCapacity: seats },
      imageUrl: imageByCategory[vehicleType],
      fallbackImageUrl: imageByCategory[vehicleType],
      baseDailyRate: adjustedDailyRate,
      baseHourlyRate: Math.max(50, Math.round(adjustedDailyRate / 10 / 10) * 10),
      minDailyRate: minimumRate,
      maxDailyRate: maximumRate,
      status: "ACTIVE",
      maintenanceStatus: "OK",
      rating: Number((4.1 + (vehicleIndex % 9) * 0.1).toFixed(1)),
      reviewCount: 18 + vehicleIndex * 7,
      demoOnly: true,
      createdAt: "2026-01-01T00:00:00.000Z"
    };
  });
});

export function initialDemoStore() {
  const demandMetrics = cities.flatMap((city, cityIndex) =>
    vehicleTypes.map((type, typeIndex) => ({
      id: stableId(3001 + cityIndex * vehicleTypes.length + typeIndex),
      cityId: city.id,
      category: type.name,
      recentBookings: (cityIndex + typeIndex * 2) % 8,
      expectedBookings: 4,
      windowDays: 7,
      source: "SIMULATED_DEMO"
    }))
  );
  return {
    users: [],
    cities,
    locations,
    vehicleTypes,
    vehicles: catalogueVehicles,
    pricing: {
      ruleVersion: "demo-v2",
      durationDiscountPercent: 10,
      earlyBookingDiscountPercent: 0,
      earlyBookingMinimumDays: 14,
      bookingFee: 0,
      taxPercent: 0,
      demandLowScore: 50,
      demandNormalScore: 100,
      demandElevatedScore: 150,
      lowDemandMultiplier: 0.9,
      normalDemandMultiplier: 1,
      demandElevatedMultiplier: 1.1,
      highDemandMultiplier: 1.2,
      availabilityLowRatio: 0.2,
      availabilityMediumRatio: 0.5,
      availabilityHighMultiplier: 1.15,
      lowAvailabilityMultiplier: 1.15,
      availabilityMediumMultiplier: 1.05,
      availabilityNormalMultiplier: 1
    },
    demandMetrics,
    peakDates: [],
    maintenancePeriods: [],
    quotes: [],
    bookings: [],
    payments: [],
    priceHistory: [],
    auditLogs: []
  };
}
