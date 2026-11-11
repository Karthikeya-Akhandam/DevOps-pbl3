import api from "../api.js";

export async function getAdminAnalytics() {
  const { data } = await api.get("/admin/analytics");
  return data;
}
