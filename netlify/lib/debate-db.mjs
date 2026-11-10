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
  if (row.eliminated) c.eliminated = true;
  return c;
}

export function byNumber(a, b) {
  const na = Number(a.number), nb = Number(b.number);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a.number).localeCompare(String(b.number));
}

/* ---------- Paystack ---------- */
export const REFERENCE_PREFIX = "RHEX-PRES-";

// Calls the Paystack API with the secret key (server-side only).
export async function paystack(path, env = process.env, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.paystack.co/${path}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.status !== false, status: res.status, body };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
export function metaOf(d) {
  return typeof d.metadata === "string" ? safeJson(d.metadata) : d.metadata || {};
}
const short = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));

// A Paystack transaction (webhook `data` or a verify/list result) → a debate_votes row,
// or null if it isn't a successful debate vote. Votes are counted from the money
// actually received, never from what the browser claimed.
export function rowFromTransaction(d, priceNaira) {
  if (!d || d.status !== "success") return null;
  if (typeof d.reference !== "string" || !d.reference.startsWith(REFERENCE_PREFIX)) return null;
  if ((d.currency || "NGN") !== "NGN") return null;
  const meta = metaOf(d);
  // The reference is RHEX-PRES-<contestant>-<random>, so it still names the
  // contestant if a payment arrives without its metadata.
  const fromRef = (d.reference.slice(REFERENCE_PREFIX.length).match(/^([A-Za-z0-9]{1,20})-/) || [])[1] || "";
  const contestant = String(meta.contestant_number || fromRef).trim();
  if (!NUMBER_RE.test(contestant)) return null;
  const amountKobo = Number(d.amount);
  const votes = Math.floor(amountKobo / (priceNaira * 100));
  if (!Number.isFinite(votes) || votes < 1) return null;

  const cust = d.customer || {};
  const auth = d.authorization || {};
  const name = meta.voter_name || [cust.first_name, cust.last_name].filter(Boolean).join(" ");
  const card = auth.last4 ? [auth.card_type || auth.brand, `·· ${auth.last4}`, auth.bank ? `(${auth.bank})` : ""].filter(Boolean).join(" ").trim() : (auth.bank || null);
  const flags = [];
  if (amountKobo % (priceNaira * 100) !== 0) flags.push("odd_amount");
  return {
    reference: d.reference,
    contestant_number: contestant,
    votes,
    amount_kobo: amountKobo,
    email: short(cust.email, 200),
    voter_name: short(name, 120),
    phone: short(meta.voter_phone || cust.phone, 40),
    channel: short(d.channel || auth.channel, 40),
    paystack_id: Number.isFinite(Number(d.id)) ? Number(d.id) : null,
    fees_kobo: Number.isFinite(Number(d.fees)) ? Number(d.fees) : null,
    gateway_response: short(d.gateway_response, 200),
    ip_address: short(d.ip_address, 60),
    card: short(card, 120),
    flags,
    paid_at: d.paid_at || d.paidAt || new Date().toISOString(),
  };
}

// Adds flags that need the database: voting closed, eliminated or unknown contestant,
// and many payments from the same email in a short time. Never blocks the vote:
// the money has already been taken, so admins review flagged payments instead.
export async function addFlags(row, env = process.env, fetchImpl = fetch) {
  const flags = new Set(row.flags || []);
  const call = (p, o) => db(p, o, env, fetchImpl).then((r) => r, () => null);
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const [settings, contestant, recent] = await Promise.all([
    call("debate_settings?select=voting_open&id=eq.1"),
    call(`debate_contestants?select=number,active,eliminated&number=eq.${encodeURIComponent(row.contestant_number)}`),
    row.email ? call(`debate_votes?select=reference&email=ilike.${encodeURIComponent(row.email.replace(/[%_*]/g, ""))}&paid_at=gte.${since}&limit=1`, { prefer: "count=exact" }) : null,
  ]);
  if (settings && settings.data[0] && settings.data[0].voting_open === false) flags.add("voting_closed");
  if (contestant) {
    const c = contestant.data[0];
    if (!c) flags.add("unknown_contestant");
    else if (c.eliminated) flags.add("eliminated");
    else if (!c.active) flags.add("hidden_contestant");
  }
  if (recent && Number((recent.headers.get("content-range") || "").split("/")[1]) >= 5) flags.add("rapid");
  return { ...row, flags: [...flags] };
}

export async function getSettings(env = process.env) {
  const { data } = await db("debate_settings?select=*&id=eq.1", {}, env);
  return data[0] || { voting_open: true, tally_hidden: false, leaderboard_scope: "total" };
}
