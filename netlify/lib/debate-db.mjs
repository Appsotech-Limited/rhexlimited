// Shared helpers for the debate show functions: Supabase REST calls with the
// service_role key (server-side only) and the contestant record shape.

export const NUMBER_RE = /^[A-Za-z0-9-]{1,20}$/;
export const PHOTO_BUCKET = "debate-contestants";

export function configured(env = process.env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

// Calls Supabase PostgREST. `path` is everything after /rest/v1/.
export async function db(path, { method = "GET", body, prefer, headers = {} } = {}, env = process.env, fetchImpl = fetch) {
  const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Supabase ${method} ${path.split("?")[0]} failed: ${res.status} ${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return { data: text ? JSON.parse(text) : null, headers: res.headers };
}

// Database row → the shape the public pages use (same as debate/data/contestants.js).
export function toPublic(row) {
  const c = { number: row.number, name: row.name };
  if (row.photo) c.photo = row.photo;
  if (row.poster) c.poster = row.poster;
  const msg = String(row.message || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (msg.length) c.message = msg;
  return c;
}

export function byNumber(a, b) {
  const na = Number(a.number), nb = Number(b.number);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a.number).localeCompare(String(b.number));
}
