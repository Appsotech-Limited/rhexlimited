// Admin API for the RHEX Reality Debate Show, used by the dashboard at /admin/.
//
// Session
//   POST   /api/admin/login                     { password } → sets a session cookie
//   POST   /api/admin/logout
//   GET    /api/admin/session
// Contestants
//   GET    /api/admin/contestants               all contestants with all-time and this-round totals
//   POST   /api/admin/contestants               add one
//   PUT    /api/admin/contestants/<number>      edit, hide/show, eliminate/reinstate (number can't change)
//   DELETE /api/admin/contestants/<number>      remove one (their payment records stay)
//   POST   /api/admin/upload                    { number, kind: "photo"|"poster", type, data(base64) } → { url }
// Votes and payments
//   GET    /api/admin/payments?contestant=&q=&email=&filter=flagged|voided|requery&limit=&offset=
//   GET    /api/admin/payments/<reference>      one stored payment
//   POST   /api/admin/payments/<reference>/void { reason }  remove from the count (e.g. refunded)
//   POST   /api/admin/payments/<reference>/restore
//   POST   /api/admin/requery                   { reference } → live Paystack status vs our record
//   POST   /api/admin/credit                    { reference } → re-verifies with Paystack, records missed votes
//   GET    /api/admin/reconcile?days=           Paystack payments from the last N days that we never recorded
//   POST   /api/admin/sync                      { days } → records every missed Paystack payment (idempotent)
//   GET    /api/admin/voters?q=&limit=&offset=  one row per voter email
//   GET    /api/admin/adjustments               manual vote adjustments
//   POST   /api/admin/adjustments               { contestant, votes (+/-), reason }
// Show controls and records
//   GET    /api/admin/settings
//   PUT    /api/admin/settings                  { voting_open, closed_message, tally_hidden, leaderboard_scope }
//   POST   /api/admin/round                     { name } → starts a new round now
//   GET    /api/admin/log?limit=&offset=        audit log of admin actions
//   GET    /api/admin/export/<payments|voters|standings|log>.csv
//
// Environment variables (Cloudflare Pages → Settings → Variables and Secrets):
//   ADMIN_PASSWORD             the dashboard password (at least 10 characters)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAYSTACK_SECRET_KEY   already set for voting
//   VOTE_PRICE_NAIRA           optional, defaults to 100
//   DEBATE_BUILD_HOOK_URL      optional deploy hook URL; when set, each contestant change
//                              rebuilds the site so WhatsApp/Facebook link previews update too
import crypto from "node:crypto";
import {
  db, configured, NUMBER_RE, PHOTO_BUCKET, byNumber, paystack, rowFromTransaction, addFlags,
  getSettings, metaOf, REFERENCE_PREFIX,
} from "../lib/debate-db.mjs";
import { paystackDebateRows, missingRows, syncPaystack } from "../lib/paystack-sync.mjs";

export const config = { path: ["/api/admin/*"] };

const COOKIE = "rhex_admin";
const SESSION_HOURS = 12;
const MAX_FAILURES = 8;          // per IP …
const FAILURE_WINDOW_MIN = 15;   // … in this many minutes
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const REF_RE = /^[A-Za-z0-9._=-]{4,120}$/;
const PAYMENT_COLS = "reference,contestant_number,votes,amount_kobo,email,voter_name,phone,channel,card,paystack_id,fees_kobo,gateway_response,ip_address,source,flags,voided,void_reason,voided_at,paid_at,created_at";

/* ---------- sessions ---------- */
function sessionKey(env) {
  // Changing the password (or the Supabase key) signs everyone out.
  return crypto.createHash("sha256").update(`rhex-admin|${env.ADMIN_PASSWORD}|${env.SUPABASE_SERVICE_ROLE_KEY}`).digest();
}
export function makeToken(env, now = Date.now()) {
  const exp = String(now + SESSION_HOURS * 3600 * 1000);
  const sig = crypto.createHmac("sha256", sessionKey(env)).update(exp).digest("base64url");
  return `${exp}.${sig}`;
}
export function validToken(token, env, now = Date.now()) {
  const [exp, sig] = String(token || "").split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  const expected = crypto.createHmac("sha256", sessionKey(env)).update(exp).digest("base64url");
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function passwordMatches(given, env) {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(env.ADMIN_PASSWORD || "")).digest();
  return crypto.timingSafeEqual(a, b);
}
function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}
function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

/* ---------- responses ---------- */
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
});
const fail = (status, error) => json({ error }, status);
const userError = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });

/* ---------- validation ---------- */
function cleanText(v, max) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).replace(/\r\n/g, "\n").trim();
  return s ? s.slice(0, max) : null;
}
function cleanImage(v) {
  const s = cleanText(v, 500);
  if (s === undefined || s === null) return s;
  // A full https URL (uploaded photos) or a path inside the site (the original photos).
  if (/^https:\/\/[^\s"'<>]+$/.test(s) || /^[A-Za-z0-9_./-]+$/.test(s) && !s.includes("..") && !s.startsWith("//")) return s;
  throw userError("Photo must be an uploaded image or a site path.");
}
export function contestantFields(input, { requireAll }) {
  const out = {};
  const name = cleanText(input.name, 120);
  if (requireAll || name !== undefined) {
    if (!name) throw userError("Enter the contestant's name.");
    out.name = name;
  }
  for (const k of ["photo", "poster"]) {
    const v = cleanImage(input[k]);
    if (v !== undefined) out[k] = v;
  }
  const message = cleanText(input.message, 2000);
  if (message !== undefined) out.message = message;
  if (input.active !== undefined) out.active = Boolean(input.active);
  if (input.eliminated !== undefined) out.eliminated = Boolean(input.eliminated);
  return out;
}

/* ---------- helpers ---------- */
const price = (env) => Number(env.VOTE_PRICE_NAIRA) || 100;
const countOf = (headers) => Number((headers.get("content-range") || "").split("/")[1]) || 0;
function clientIp(req, context) {
  return (context && context.ip) || req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
async function rebuild(env) {
  if (!env.DEBATE_BUILD_HOOK_URL) return;
  try { await fetch(env.DEBATE_BUILD_HOOK_URL, { method: "POST" }); } catch (e) { console.error("build hook:", e.message); }
}
async function totals(since) {
  const { data } = await db("rpc/debate_totals", { method: "POST", body: { since: since || null } });
  const t = {};
  for (const r of data) {
    t[r.contestant_number] = {
      votes: Number(r.votes) || 0, amountKobo: Number(r.amount_kobo) || 0,
      payments: Number(r.payments) || 0, adjustment: Number(r.adjustment) || 0,
    };
  }
  return t;
}
const ZERO = { votes: 0, amountKobo: 0, payments: 0, adjustment: 0 };
const ilikeSafe = (s) => String(s || "").trim().replace(/[^A-Za-z0-9@._+-]/g, "").slice(0, 80);

function paymentFilter(url) {
  const parts = [];
  const c = (url.searchParams.get("contestant") || "").trim();
  if (c) {
    if (!NUMBER_RE.test(c)) throw userError("Bad contestant number.");
    parts.push(`contestant_number=eq.${encodeURIComponent(c)}`);
  }
  const email = ilikeSafe(url.searchParams.get("email"));
  if (email) parts.push(`email=ilike.${encodeURIComponent(email)}`);
  const q = ilikeSafe(url.searchParams.get("q"));
  if (q) parts.push(`or=(${["email", "reference", "voter_name", "phone"].map((f) => `${f}.ilike."*${encodeURIComponent(q)}*"`).join(",")})`);
  const filter = url.searchParams.get("filter");
  if (filter === "flagged") parts.push("flags=neq.{}");
  else if (filter === "voided") parts.push("voided=is.true");
  else if (filter === "requery") parts.push("source=eq.requery");
  return parts;
}

// Only the parts of a Paystack transaction worth showing. The reusable card
// authorization code and other secrets are dropped.
export function paystackSummary(d) {
  if (!d) return null;
  const cust = d.customer || {}, auth = d.authorization || {}, meta = metaOf(d);
  return {
    id: d.id, reference: d.reference, status: d.status, amountKobo: Number(d.amount) || 0, currency: d.currency,
    channel: d.channel, gatewayResponse: d.gateway_response, paidAt: d.paid_at || d.paidAt || null,
    createdAt: d.created_at || d.createdAt || null, feesKobo: d.fees == null ? null : Number(d.fees),
    ipAddress: d.ip_address || null,
    customer: { email: cust.email || null, name: [cust.first_name, cust.last_name].filter(Boolean).join(" ") || null, phone: cust.phone || null },
    card: auth.last4 ? { type: auth.card_type || auth.brand || null, last4: auth.last4, bank: auth.bank || null, country: auth.country_code || null } : (auth.bank ? { bank: auth.bank } : null),
    metadata: {
      contestant_number: meta.contestant_number || null, contestant_name: meta.contestant_name || null,
      votes: meta.votes || null, voter_name: meta.voter_name || null, source: meta.source || null,
    },
  };
}

async function verify(reference, env) {
  if (!env.PAYSTACK_SECRET_KEY) throw userError("PAYSTACK_SECRET_KEY isn't set in the hosting settings, so Paystack can't be checked.", 503);
  const r = await paystack(`transaction/verify/${encodeURIComponent(reference)}`, env);
  if (r.status === 404 || (r.body && /not found/i.test(r.body.message || ""))) return null;
  if (!r.ok) throw userError(`Paystack said: ${(r.body && r.body.message) || r.status}`, 502);
  return r.body.data;
}

async function stored(reference) {
  const { data } = await db(`debate_votes?select=${PAYMENT_COLS}&reference=eq.${encodeURIComponent(reference)}`);
  return data[0] || null;
}

const csvCell = (v) => {
  let s = v == null ? "" : Array.isArray(v) ? v.join(" ") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep Excel from running it as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function csv(name, header, rows) {
  const lines = [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rhex-debate-${name}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
async function all(pathWithQuery) {
  const rows = [];
  for (let offset = 0; offset < 200000; offset += 1000) {
    const { data } = await db(`${pathWithQuery}&limit=1000&offset=${offset}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}
const naira = (kobo) => (Number(kobo || 0) / 100).toFixed(2);

/* ---------- handler ---------- */
export default async (req, context) => {
  const env = process.env;
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");
  const method = req.method;
  const ip = clientIp(req, context);

  if (!env.ADMIN_PASSWORD || String(env.ADMIN_PASSWORD).length < 10) {
    return fail(503, "The admin password isn't set up yet. Add ADMIN_PASSWORD (10+ characters) in the hosting settings, then redeploy.");
  }
  if (!configured(env)) return fail(503, "Supabase isn't configured on this site.");

  // Writes must come from the dashboard itself (blocks cross-site form posts).
  if (method !== "GET" && req.headers.get("x-rhex-admin") !== "1") return fail(403, "Forbidden");

  // Audit log. Never lets a logging problem break the action itself.
  const log = (action, target, details) => db("debate_admin_log", {
    method: "POST", prefer: "return=minimal",
    body: { action, target: target == null ? null : String(target), details: details || null, ip, user_agent: (req.headers.get("user-agent") || "").slice(0, 300) },
  }).catch((e) => console.error("audit log:", e.message));

  try {
    if (route === "login" && method === "POST") {
      const since = new Date(Date.now() - FAILURE_WINDOW_MIN * 60000).toISOString();
      const { headers } = await db(`debate_admin_login_failures?select=id&ip=eq.${encodeURIComponent(ip)}&at=gte.${since}&limit=1`, { prefer: "count=exact" });
      if (countOf(headers) >= MAX_FAILURES) return fail(429, `Too many wrong passwords. Try again in ${FAILURE_WINDOW_MIN} minutes.`);

      const body = await req.json().catch(() => ({}));
      if (!passwordMatches(body.password, env)) {
        await db("debate_admin_login_failures", { method: "POST", body: { ip }, prefer: "return=minimal" });
        await log("login_failed", null, null);
        await new Promise((r) => setTimeout(r, 700));
        return fail(401, "Wrong password.");
      }
      db(`debate_admin_login_failures?at=lt.${since}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
      await log("login", null, null);
      return json({ ok: true }, 200, { "Set-Cookie": cookieHeader(makeToken(env), SESSION_HOURS * 3600) });
    }
    if (route === "logout" && method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
    }

    if (!validToken(readCookie(req, COOKIE), env)) return fail(401, "Please sign in.");

    if (route === "session" && method === "GET") return json({ ok: true, paystack: Boolean(env.PAYSTACK_SECRET_KEY) });

    /* ----- contestants ----- */
    if (route === "contestants" && method === "GET") {
      const settings = await getSettings(env);
      const [{ data }, allTime, round] = await Promise.all([
        db("debate_contestants?select=number,name,photo,poster,message,active,eliminated,eliminated_at,eliminated_round,updated_at"),
        totals(null),
        settings.round_started_at ? totals(settings.round_started_at) : Promise.resolve(null),
      ]);
      const known = new Set(data.map((c) => c.number));
      const orphans = Object.keys(allTime).filter((n) => !known.has(n));
      return json({
        contestants: data.sort(byNumber).map((c) => ({
          ...c, ...(allTime[c.number] || ZERO),
          round: round ? (round[c.number] || ZERO).votes : null,
        })),
        orphans: orphans.map((n) => ({ number: n, ...allTime[n] })),
        settings,
        votePrice: price(env),
        paystack: Boolean(env.PAYSTACK_SECRET_KEY),
      });
    }
    if (route === "contestants" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const number = String(body.number || "").trim();
      if (!NUMBER_RE.test(number)) return fail(400, "The contestant number can only use letters, digits and dashes (up to 20).");
      const row = { number, ...contestantFields(body, { requireAll: true }) };
      try {
        const { data } = await db("debate_contestants", { method: "POST", body: row, prefer: "return=representation" });
        await log("contestant_add", number, { name: row.name });
        await rebuild(env);
        return json({ contestant: data[0] }, 201);
      } catch (err) {
        if (err.status === 409) return fail(409, `Contestant number ${number} already exists.`);
        throw err;
      }
    }
    const one = route.match(/^contestants\/([A-Za-z0-9-]{1,20})$/);
    if (one && method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const fields = contestantFields(body, { requireAll: false });
      if (fields.eliminated !== undefined) {
        const s = await getSettings(env);
        fields.eliminated_at = fields.eliminated ? new Date().toISOString() : null;
        fields.eliminated_round = fields.eliminated ? (s.round_name || null) : null;
      }
      fields.updated_at = new Date().toISOString();
      const { data } = await db(`debate_contestants?number=eq.${encodeURIComponent(one[1])}`, { method: "PATCH", body: fields, prefer: "return=representation" });
      if (!data.length) return fail(404, "That contestant no longer exists.");
      const action = fields.eliminated === true ? "contestant_eliminate" : fields.eliminated === false ? "contestant_reinstate"
        : Object.keys(body).length === 1 && body.active !== undefined ? (body.active ? "contestant_show" : "contestant_hide") : "contestant_edit";
      const changed = { ...fields }; delete changed.updated_at;
      await log(action, one[1], changed);
      await rebuild(env);
      return json({ contestant: data[0] });
    }
    if (one && method === "DELETE") {
      const { data } = await db(`debate_contestants?number=eq.${encodeURIComponent(one[1])}`, { method: "DELETE", prefer: "return=representation" });
      if (!data.length) return fail(404, "That contestant no longer exists.");
      await log("contestant_delete", one[1], { name: data[0].name });
      await rebuild(env);
      return json({ ok: true });
    }

    /* ----- photo upload ----- */
    if (route === "upload" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const number = String(body.number || "").trim();
      const kind = body.kind === "poster" ? "poster" : "photo";
      const ext = IMAGE_TYPES[body.type];
      if (!NUMBER_RE.test(number)) return fail(400, "Enter the contestant number before adding a photo.");
      if (!ext) return fail(400, "Use a JPG, PNG or WebP image.");
      const bytes = Buffer.from(String(body.data || ""), "base64");
      if (!bytes.length) return fail(400, "The image was empty.");
      if (bytes.length > MAX_UPLOAD_BYTES) return fail(413, "That image is too large. Use one under 4 MB.");
      const objectPath = `${number}/${kind}-${Date.now().toString(36)}.${ext}`;
      const base = env.SUPABASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/storage/v1/object/${PHOTO_BUCKET}/${objectPath}`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": body.type,
          "Cache-Control": "31536000",
          "x-upsert": "true",
        },
        body: bytes,
      });
      if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
      return json({ url: `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${objectPath}` });
    }

    /* ----- payments ----- */
    if (route === "payments" && method === "GET") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const qs = [`select=${PAYMENT_COLS}`, ...paymentFilter(url), "order=paid_at.desc", `limit=${limit}`, `offset=${offset}`].join("&");
      const { data, headers } = await db(`debate_votes?${qs}`, { prefer: "count=exact" });
      return json({ payments: data, total: countOf(headers), limit, offset });
    }
    const pay = route.match(/^payments\/([A-Za-z0-9._=-]{4,120})(?:\/(void|restore))?$/);
    if (pay && method === "GET" && !pay[2]) {
      const row = await stored(pay[1]);
      return row ? json({ payment: row }) : fail(404, "No payment with that reference is recorded.");
    }
    if (pay && method === "POST" && pay[2]) {
      const body = await req.json().catch(() => ({}));
      const voiding = pay[2] === "void";
      const reason = cleanText(body.reason, 300);
      if (voiding && !reason) return fail(400, "Give a reason for removing this payment from the count.");
      const patch = voiding ? { voided: true, void_reason: reason, voided_at: new Date().toISOString() } : { voided: false, void_reason: null, voided_at: null };
      const { data } = await db(`debate_votes?reference=eq.${encodeURIComponent(pay[1])}`, { method: "PATCH", body: patch, prefer: "return=representation" });
      if (!data.length) return fail(404, "No payment with that reference is recorded.");
      await log(voiding ? "payment_void" : "payment_restore", pay[1], { reason, votes: data[0].votes, contestant: data[0].contestant_number });
      return json({ payment: data[0] });
    }

    /* ----- live Paystack requery ----- */
    if (route === "requery" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const reference = String(body.reference || "").trim();
      if (!REF_RE.test(reference)) return fail(400, "Enter a valid Paystack reference.");
      const [tx, row] = await Promise.all([verify(reference, env), stored(reference)]);
      const expected = tx ? rowFromTransaction(tx, price(env)) : null;
      const notes = [];
      if (!tx) notes.push("Paystack has no transaction with this reference.");
      else if (tx.status !== "success") notes.push(`Paystack status is "${tx.status}", so no votes are due.`);
      else if (!expected) notes.push(reference.startsWith(REFERENCE_PREFIX) ? "This payment can't be matched to a contestant (missing number or too small)." : "This isn't a debate vote payment.");
      if (row && tx && tx.status !== "success" && !row.voided) notes.push("We counted this payment but Paystack no longer shows it as successful (refund or reversal?). Consider removing it from the count.");
      if (row && expected && (row.amount_kobo !== expected.amount_kobo || row.contestant_number !== expected.contestant_number)) notes.push("Our record doesn't match Paystack's amount or contestant.");
      if (!row && expected) notes.push(`This payment was never recorded. Crediting it adds ${expected.votes} vote(s) to No. ${expected.contestant_number}.`);
      if (row && expected && !notes.length) notes.push("All good: Paystack and our record agree.");
      await log("requery", reference, { paystack_status: tx ? tx.status : "not_found", recorded: Boolean(row) });
      return json({ paystack: paystackSummary(tx), recorded: row, canCredit: Boolean(expected && !row), expected: expected && { contestant: expected.contestant_number, votes: expected.votes }, notes });
    }
    if (route === "credit" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const reference = String(body.reference || "").trim();
      if (!REF_RE.test(reference)) return fail(400, "Enter a valid Paystack reference.");
      const tx = await verify(reference, env); // always re-check with Paystack, never trust the browser
      const row = tx && rowFromTransaction(tx, price(env));
      if (!row) return fail(400, "Paystack doesn't show this as a successful debate vote payment, so nothing was credited.");
      const flagged = await addFlags({ ...row, source: "requery" }, env).catch(() => ({ ...row, source: "requery" }));
      const { data } = await db("debate_votes", { method: "POST", body: flagged, prefer: "resolution=ignore-duplicates,return=representation" });
      if (!data.length) return fail(409, "This payment is already recorded.");
      await log("payment_credit", reference, { contestant: row.contestant_number, votes: row.votes, amount_kobo: row.amount_kobo });
      return json({ payment: data[0] }, 201);
    }
    if (route === "reconcile" && method === "GET") {
      if (!env.PAYSTACK_SECRET_KEY) return fail(503, "PAYSTACK_SECRET_KEY isn't set in the hosting settings, so Paystack can't be checked.");
      const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days")) || 3));
      const { rows, checked, truncated } = await paystackDebateRows(env, days);
      const missing = (await missingRows(rows, env)).map((r) => ({
        reference: r.reference, contestant: r.contestant_number, votes: r.votes,
        amountKobo: r.amount_kobo, email: r.email, paidAt: r.paid_at,
      }));
      await log("reconcile", null, { days, checked: rows.length, missing: missing.length });
      return json({ days, checked: rows.length, paystackTotal: checked, missing, truncated });
    }
    // Records every successful Paystack payment that isn't counted yet, in one go.
    if (route === "sync" && method === "POST") {
      if (!env.PAYSTACK_SECRET_KEY) return fail(503, "PAYSTACK_SECRET_KEY isn't set in the hosting settings, so Paystack can't be checked.");
      const body = await req.json().catch(() => ({}));
      const days = Math.min(30, Math.max(1, Number(body.days) || 3));
      const r = await syncPaystack(env, { days });
      await log("paystack_sync", null, { days, checked: r.debate, added: r.added.length, votes: r.votes, references: r.added.map((a) => a.reference) });
      return json({ days, checked: r.debate, added: r.added, votes: r.votes, truncated: r.truncated });
    }

    /* ----- voters ----- */
    if (route === "voters" && method === "GET") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const q = ilikeSafe(url.searchParams.get("q"));
      const sort = url.searchParams.get("sort") === "recent" ? "last_paid.desc" : "votes.desc";
      const qs = ["select=*", q ? `or=(email.ilike."*${encodeURIComponent(q)}*",name.ilike."*${encodeURIComponent(q)}*",phone.ilike."*${encodeURIComponent(q)}*")` : "", `order=${sort}`, `limit=${limit}`, `offset=${offset}`].filter(Boolean).join("&");
      const { data, headers } = await db(`debate_voters?${qs}`, { prefer: "count=exact" });
      return json({ voters: data, total: countOf(headers), limit, offset });
    }

    /* ----- manual adjustments ----- */
    if (route === "adjustments" && method === "GET") {
      const { data } = await db("debate_vote_adjustments?select=*&order=created_at.desc&limit=200");
      return json({ adjustments: data });
    }
    if (route === "adjustments" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const contestant = String(body.contestant || "").trim();
      const votes = Math.trunc(Number(body.votes));
      const reason = cleanText(body.reason, 300);
      if (!NUMBER_RE.test(contestant)) return fail(400, "Pick a contestant.");
      if (!Number.isFinite(votes) || votes === 0 || Math.abs(votes) > 1000000) return fail(400, "Enter the number of votes to add (or a minus number to remove).");
      if (!reason) return fail(400, "A reason is required for every manual adjustment.");
      const { data } = await db("debate_vote_adjustments", { method: "POST", body: { contestant_number: contestant, votes, reason }, prefer: "return=representation" });
      await log("vote_adjust", contestant, { votes, reason });
      return json({ adjustment: data[0] }, 201);
    }

    /* ----- show controls ----- */
    if (route === "settings" && method === "GET") return json({ settings: await getSettings(env) });
    if (route === "settings" && method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const patch = {};
      if (body.voting_open !== undefined) patch.voting_open = Boolean(body.voting_open);
      if (body.tally_hidden !== undefined) patch.tally_hidden = Boolean(body.tally_hidden);
      if (body.closed_message !== undefined) patch.closed_message = cleanText(body.closed_message, 300);
      if (body.leaderboard_scope !== undefined) {
        if (!["total", "round"].includes(body.leaderboard_scope)) return fail(400, "Leaderboard must show all-time or this-round votes.");
        patch.leaderboard_scope = body.leaderboard_scope;
      }
      if (!Object.keys(patch).length) return fail(400, "Nothing to change.");
      patch.updated_at = new Date().toISOString();
      const { data } = await db("debate_settings?id=eq.1", { method: "PATCH", body: patch, prefer: "return=representation" });
      const changed = { ...patch }; delete changed.updated_at;
      await log("settings", null, changed);
      return json({ settings: data[0] });
    }
    if (route === "round" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const name = cleanText(body.name, 80);
      if (!name) return fail(400, "Name the round, for example \"Round 2\" or \"Semi-final\".");
      const { data } = await db("debate_settings?id=eq.1", { method: "PATCH", body: { round_name: name, round_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }, prefer: "return=representation" });
      await log("round_start", name, null);
      return json({ settings: data[0] });
    }

    /* ----- audit log ----- */
    if (route === "log" && method === "GET") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const { data, headers } = await db(`debate_admin_log?select=id,at,action,target,details,ip&order=at.desc&limit=${limit}&offset=${offset}`, { prefer: "count=exact" });
      return json({ log: data, total: countOf(headers), limit, offset });
    }

    /* ----- CSV exports ----- */
    const exp = route.match(/^export\/(payments|voters|standings|log)\.csv$/);
    if (exp && method === "GET") {
      await log("export", exp[1], null);
      if (exp[1] === "payments") {
        const rows = await all(`debate_votes?${[`select=${PAYMENT_COLS}`, ...paymentFilter(url), "order=paid_at.desc"].join("&")}`);
        return csv("payments", ["Paid at", "Reference", "Contestant", "Votes", "Amount (NGN)", "Fees (NGN)", "Voter name", "Email", "Phone", "Channel", "Card / bank", "Source", "Flags", "Voided", "Void reason", "Paystack ID", "IP address"],
          rows.map((r) => [r.paid_at, r.reference, r.contestant_number, r.votes, naira(r.amount_kobo), r.fees_kobo == null ? "" : naira(r.fees_kobo), r.voter_name, r.email, r.phone, r.channel, r.card, r.source, r.flags, r.voided ? "yes" : "", r.void_reason, r.paystack_id, r.ip_address]));
      }
      if (exp[1] === "voters") {
        const rows = await all("debate_voters?select=*&order=votes.desc");
        return csv("voters", ["Email", "Name", "Phone", "Votes", "Amount (NGN)", "Payments", "Contestants voted for", "First vote", "Last vote", "Flagged"],
          rows.map((r) => [r.email, r.name, r.phone, r.votes, naira(r.amount_kobo), r.payments, r.contestants, r.first_paid, r.last_paid, r.flagged ? "yes" : ""]));
      }
      if (exp[1] === "standings") {
        const s = await getSettings(env);
        const [{ data }, allTime, round] = await Promise.all([
          db("debate_contestants?select=number,name,active,eliminated,eliminated_round"), totals(null),
          s.round_started_at ? totals(s.round_started_at) : Promise.resolve(null),
        ]);
        const list = data.map((c) => ({ ...c, ...(allTime[c.number] || ZERO), round: round ? (round[c.number] || ZERO).votes : "" }))
          .sort((a, b) => b.votes - a.votes);
        return csv("standings", ["Rank", "Number", "Name", "Votes (all time)", `Votes (${s.round_name || "this round"})`, "Paid votes amount (NGN)", "Payments", "Manual adjustment", "Status"],
          list.map((c, i) => [i + 1, c.number, c.name, c.votes, c.round, naira(c.amountKobo), c.payments, c.adjustment, c.eliminated ? `Eliminated${c.eliminated_round ? ` (${c.eliminated_round})` : ""}` : c.active ? "In the race" : "Hidden"]));
      }
      const rows = await all("debate_admin_log?select=at,action,target,details,ip&order=at.desc");
      return csv("audit-log", ["When", "Action", "Target", "Details", "IP"], rows.map((r) => [r.at, r.action, r.target, r.details ? JSON.stringify(r.details) : "", r.ip]));
    }

    return fail(404, "Not found");
  } catch (err) {
    if (err.expose) return fail(err.status, err.message);
    console.error("admin api:", err);
    return fail(500, "Something went wrong on the server. Please try again.");
  }
};
