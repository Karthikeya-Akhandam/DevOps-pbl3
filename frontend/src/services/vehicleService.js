import api from "../api.js";

export async function listVehicles(filters = {}) {
  const { data } = await api.get("/vehicles", { params: filters });
  return data;
}

export async function listCities() {
  const { data } = await api.get("/cities");
  return data;
}

export async function listLocations(cityId) {
  const { data } = await api.get("/locations", { params: cityId ? { cityId } : {} });
  return data;
}
