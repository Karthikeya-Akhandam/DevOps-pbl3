import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const backendDirectory = fileURLToPath(new URL("..", import.meta.url));
const serverFile = join(backendDirectory, "src", "server.js");

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("API supports registration, authorization, quotes, booking, and idempotent mock payment", { timeout: 30_000 }, async (t) => {
  const port = await unusedPort();
  const directory = mkdtempSync(join(tmpdir(), "rental-api-test-"));
  const child = spawn(process.execPath, [serverFile], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: "integration-test-secret-value-with-more-than-32-characters",
      ADMIN_EMAIL: "admin@test.local",
      ADMIN_PASSWORD: "Integration-admin-password-123",
      STORE_FILE: join(directory, "store.json"),
      FRONTEND_ORIGIN: "http://localhost:5173"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${port}/api`;
  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, options);
    const body = response.status === 204 ? null : await response.json();
    return { response, body };
  };

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`API process exited early:\n${output}`);
      try {
        const health = await request("/health");
        if (health.response.ok) { ready = true; break; }
      } catch { /* Wait briefly for the local server to bind. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `API failed to start:\n${output}`);

    const registration = await request("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test Customer", email: `test-${Date.now()}@local.test`, password: "customer-password-123" })
    });
    assert.equal(registration.response.status, 201);
    assert.equal(registration.body.user.role, "CUSTOMER");
    const customerToken = registration.body.token;
    const auth = { authorization: `Bearer ${customerToken}`, "content-type": "application/json" };
    const staleToken = jwt.sign(
      { sub: "00000000-0000-4000-8000-999999999999", role: "CUSTOMER" },
      "integration-test-secret-value-with-more-than-32-characters"
    );
    const staleSession = await request("/auth/me", { headers: { authorization: `Bearer ${staleToken}` } });
    assert.equal(staleSession.response.status, 401);
    assert.equal(staleSession.body.error, "This session is no longer valid. Sign in again.");

    const deniedAdmin = await request("/admin/dashboard", { headers: auth });
    assert.equal(deniedAdmin.response.status, 403);
    const vehicles = await request("/vehicles");
    assert.equal(vehicles.response.status, 200);
    assert.equal(vehicles.body.length, 432);
    assert.ok(vehicles.body[0].base_daily_rate > 0);
    assert.ok(vehicles.body[0].vehicle_type);
    const cities = await request("/cities");
    assert.equal(cities.body.length, 12);
    const cityVehicles = await request(`/vehicles?cityId=${vehicles.body[0].city_id}`);
    assert.equal(cityVehicles.body.length, 36);
    assert.equal(new Set(cityVehicles.body.map((vehicle) => `${vehicle.brand} ${vehicle.model}`)).size, 36);
    const locations = await request(`/locations?cityId=${vehicles.body[0].city_id}`);
    assert.ok(locations.body.length > 0);
    assert.ok(locations.body.every((location) => location.cityId === vehicles.body[0].city_id));
    const vehicleId = vehicles.body[0].id;
    const pickup = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const dropoff = new Date(pickup.getTime() + 2 * 60 * 60 * 1000);
    const rental = { vehicleId, pickupAt: pickup.toISOString(), returnAt: dropoff.toISOString() };

    const getQuote = () => request("/pricing/quote", {
      method: "POST", headers: auth, body: JSON.stringify(rental)
    });
    const firstQuote = await getQuote();
    const secondQuote = await getQuote();
    assert.equal(firstQuote.response.status, 201);
    assert.equal(firstQuote.body.quote.breakdown.rateUnit, "hour");
    assert.equal(secondQuote.response.status, 201);

    const [firstAttempt, secondAttempt] = await Promise.all([
      request("/bookings", { method: "POST", headers: auth, body: JSON.stringify({ quoteId: firstQuote.body.quote.id }) }),
      request("/bookings", { method: "POST", headers: auth, body: JSON.stringify({ quoteId: secondQuote.body.quote.id }) })
    ]);
    const successfulAttempt = [firstAttempt, secondAttempt].find((attempt) => attempt.response.status === 201);
    const rejectedAttempt = [firstAttempt, secondAttempt].find((attempt) => attempt.response.status === 409);
    assert.ok(successfulAttempt, "one concurrent overlapping reservation should be accepted");
    assert.ok(rejectedAttempt, "the competing overlapping reservation should be rejected");
    const bookingId = successfulAttempt.body.booking.id;

    const payment = await request("/payments/mock-checkout", {
      method: "POST", headers: auth,
      body: JSON.stringify({ bookingId, simulate: "success" })
    });
    assert.equal(payment.response.status, 200);
    assert.equal(payment.body.bookingStatus, "CONFIRMED");
    const cityAvailability = await request(`/vehicles?cityId=${vehicles.body.find((vehicle) => vehicle.id === vehicleId).city_id}&pickupAt=${encodeURIComponent(rental.pickupAt)}&returnAt=${encodeURIComponent(rental.returnAt)}`);
    assert.equal(cityAvailability.body.length, 35);
    assert.ok(cityAvailability.body.every((vehicle) => vehicle.id !== vehicleId));
    const otherCityId = cities.body.find((city) => city.id !== vehicles.body.find((vehicle) => vehicle.id === vehicleId).city_id).id;
    const otherCityAvailability = await request(`/vehicles?cityId=${otherCityId}&pickupAt=${encodeURIComponent(rental.pickupAt)}&returnAt=${encodeURIComponent(rental.returnAt)}`);
    assert.equal(otherCityAvailability.body.length, 36);
    const retry = await request("/payments/mock-checkout", {
      method: "POST", headers: auth,
      body: JSON.stringify({ bookingId, simulate: "success" })
    });
    assert.equal(retry.body.idempotent, true);

    const history = await request("/bookings/my", { headers: auth });
    assert.equal(history.body[0].payment_status, "PAID");
    assert.equal(history.body[0].status, "CONFIRMED");
    const receipt = await request(`/bookings/${bookingId}`, { headers: auth });
    assert.equal(receipt.response.status, 200);
    assert.equal(receipt.body.booking.id, bookingId);
    assert.ok(receipt.body.priceSnapshot.total > 0);

    const adminLogin = await request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@test.local", password: "Integration-admin-password-123" })
    });
    assert.equal(adminLogin.response.status, 200);
    const adminHeaders = { authorization: `Bearer ${adminLogin.body.token}` };
    const dashboard = await request("/admin/dashboard", { headers: adminHeaders });
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.body.confirmed_bookings, 1);
    const pricingSettings = await request("/admin/pricing-settings", { headers: adminHeaders });
    assert.equal(pricingSettings.response.status, 200);
    assert.equal(pricingSettings.body.tax_percent, 0);
    const settingsUpdate = await request("/admin/pricing-settings", {
      method: "PATCH",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        durationDiscountPercent: 10, taxPercent: 5, earlyBookingDiscountPercent: 0,
        earlyBookingMinimumDays: 14, bookingFee: 0, lowDemandMultiplier: 0.9,
        normalDemandMultiplier: 1, highDemandMultiplier: 1.2, demandLowScore: 50,
        demandNormalScore: 100, demandElevatedScore: 150, demandElevatedMultiplier: 1.1,
        lowAvailabilityMultiplier: 1.15, peakMultiplier: 1.1, availabilityLowRatio: 0.2,
        availabilityMediumRatio: 0.5, availabilityMediumMultiplier: 1.05
      })
    });
    assert.equal(settingsUpdate.response.status, 200);
    assert.equal(settingsUpdate.body.tax_percent, 5);
    const simulated = await request("/admin/pricing-simulator", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        vehicleId, pickupAt: rental.pickupAt, returnAt: rental.returnAt,
        recentBookings: 8, expectedBookings: 4, availableVehicles: 1,
        comparableVehicles: 10, peakEnabled: true
      })
    });
    assert.equal(simulated.response.status, 200);
    assert.equal(simulated.body.simulated, true);
    assert.ok(simulated.body.quote.total > 0);
    const availability = await request(`/vehicles/${vehicleId}/availability?pickupAt=${encodeURIComponent(rental.pickupAt)}&returnAt=${encodeURIComponent(rental.returnAt)}`);
    assert.equal(availability.body.available, false);

    const cancelled = await request(`/bookings/${bookingId}/cancel`, {
      method: "POST", headers: auth
    });
    assert.equal(cancelled.response.status, 200);
    const afterCancellation = await request("/bookings/my", { headers: auth });
    assert.equal(afterCancellation.body[0].status, "CANCELLED");
    assert.equal(afterCancellation.body[0].payment_status, "REFUNDED");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
    rmSync(directory, { recursive: true, force: true });
  }
});
