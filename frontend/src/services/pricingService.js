import api from "../api.js";

export async function requestPriceQuote(input) {
  const { data } = await api.post("/pricing/quote", input);
  return data.quote;
}

export async function simulatePrice(input) {
  const { data } = await api.post("/admin/pricing-simulator", input);
  return data;
}
