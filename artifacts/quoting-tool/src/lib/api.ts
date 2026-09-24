/** Base path the app is served from ("" at the site root). */
export const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

/** Small JSON/multipart fetch helper for the management endpoints (throws with the server's message). */
export async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE_URL}/api${path}`, init);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const logoUrl = (id: string) => `${BASE_URL}/api/data-sources/${encodeURIComponent(id)}/logo`;
export const profilePath = (id: string, setup = false) => `/data-sources/${encodeURIComponent(id)}/profile${setup ? "?setup=1" : ""}`;
export const managePath = (id: string) => `/data-sources/${encodeURIComponent(id)}`;
export const quotePath = (id: string) => `/quote/${encodeURIComponent(id)}`;
