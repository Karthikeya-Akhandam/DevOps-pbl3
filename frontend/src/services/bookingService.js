import api from "../api.js";

export async function createBooking(quoteId) {
  const { data } = await api.post("/bookings", { quoteId });
  return data.booking;
}

export async function payMockBooking(bookingId, simulate) {
  const { data } = await api.post("/payments/mock-checkout", { bookingId, simulate });
  return data;
}

export async function getBooking(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}`);
  return data;
}
