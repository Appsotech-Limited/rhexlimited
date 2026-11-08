// Admin API for the RHEX Reality Debate Show, used by the dashboard at /admin/.
//
//   POST   /api/admin/login                 { password } → sets a session cookie
//   POST   /api/admin/logout
//   GET    /api/admin/session
//   GET    /api/admin/contestants           all contestants (including hidden) with vote totals
//   POST   /api/admin/contestants           add one
//   PUT    /api/admin/contestants/<number>  edit one (the number itself can't change)
//   DELETE /api/admin/contestants/<number>  remove one (their votes stay in the records)
//   POST   /api/admin/upload                { number, kind: "photo"|"poster", type, data(base64) } → { url }
//   GET    /api/admin/payments?contestant=&q=&limit=&offset=
//   GET    /api/admin/payments.csv          every payment, for Excel
//
// Environment variables (Netlify → Site configuration → Environment variables):
//   ADMIN_PASSWORD             the dashboard password (at least 10 characters)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   already set for the vote counter
//   DEBATE_BUILD_HOOK_URL      optional Netlify build hook; when set, each contestant change
//                              rebuilds the site so WhatsApp/Facebook link previews update too
import crypto from "node:crypto";
import { db, configured, NUMBER_RE, PHOTO_BUCKET, byNumber } from "../lib/debate-db.mjs";

export const config = { path: ["/api/admin/*"] };

const COOKIE = "rhex_admin";
const SESSION_HOURS = 12;
const MAX_FAILURES = 8;          // per IP …
const FAILURE_WINDOW_MIN = 15;   // … in this many minutes
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

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

/* ---------- contestant validation ---------- */
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
  throw Object.assign(new Error("Photo must be an uploaded image or a site path."), { status: 400, expose: true });
}
export function contestantFields(input, { requireAll }) {
  const out = {};
  const name = cleanText(input.name, 120);
  if (requireAll || name !== undefined) {
    if (!name) throw Object.assign(new Error("Enter the contestant's name."), { status: 400, expose: true });
    out.name = name;
  }
  for (const k of ["photo", "poster"]) {
    const v = cleanImage(input[k]);
    if (v !== undefined) out[k] = v;
  }
  const message = cleanText(input.message, 2000);
  if (message !== undefined) out.message = message;
  if (input.active !== undefined) out.active = Boolean(input.active);
  return out;
}

/* ---------- helpers ---------- */
function clientIp(req, context) {
  return (context && context.ip) || req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
async function rebuild(env) {
  if (!env.DEBATE_BUILD_HOOK_URL) return;
  try { await fetch(env.DEBATE_BUILD_HOOK_URL, { method: "POST" }); } catch (e) { console.error("build hook:", e.message); }
}
async function totalsByContestant() {
  const { data } = await db("debate_vote_totals?select=contestant_number,votes,amount_kobo,payments");
  const t = {};
  for (const r of data) t[r.contestant_number] = { votes: Number(r.votes) || 0, amountKobo: Number(r.amount_kobo) || 0, payments: Number(r.payments) || 0 };
  return t;
}
function paymentFilter(url) {
  const parts = [];
  const c = (url.searchParams.get("contestant") || "").trim();
  if (c) {
    if (!NUMBER_RE.test(c)) throw Object.assign(new Error("Bad contestant number."), { status: 400, expose: true });
    parts.push(`contestant_number=eq.${encodeURIComponent(c)}`);
  }
  const q = (url.searchParams.get("q") || "").trim().replace(/[^A-Za-z0-9@._+-]/g, "").slice(0, 80);
  if (q) parts.push(`or=(${["email", "reference"].map((f) => `${f}.ilike."*${encodeURIComponent(q)}*"`).join(",")})`);
  return parts;
}
const csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep Excel from running it as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ---------- handler ---------- */
export default async (req, context) => {
  const env = process.env;
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");
  const method = req.method;

  if (!env.ADMIN_PASSWORD || String(env.ADMIN_PASSWORD).length < 10) {
    return fail(503, "The admin password isn't set up yet. Add ADMIN_PASSWORD (10+ characters) in Netlify, then redeploy.");
  }
  if (!configured(env)) return fail(503, "Supabase isn't configured on this site.");

  // Writes must come from the dashboard itself (blocks cross-site form posts).
  if (method !== "GET" && req.headers.get("x-rhex-admin") !== "1") return fail(403, "Forbidden");

  try {
    if (route === "login" && method === "POST") {
      const ip = clientIp(req, context);
      const since = new Date(Date.now() - FAILURE_WINDOW_MIN * 60000).toISOString();
      const { headers } = await db(`debate_admin_login_failures?select=id&ip=eq.${encodeURIComponent(ip)}&at=gte.${since}&limit=1`, { prefer: "count=exact" });
      const failures = Number((headers.get("content-range") || "").split("/")[1]) || 0;
      if (failures >= MAX_FAILURES) return fail(429, `Too many wrong passwords. Try again in ${FAILURE_WINDOW_MIN} minutes.`);

      const body = await req.json().catch(() => ({}));
      if (!passwordMatches(body.password, env)) {
        await db("debate_admin_login_failures", { method: "POST", body: { ip }, prefer: "return=minimal" });
        await new Promise((r) => setTimeout(r, 700));
        return fail(401, "Wrong password.");
      }
      // Tidy up old failure rows now and then.
      db(`debate_admin_login_failures?at=lt.${since}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
      return json({ ok: true }, 200, { "Set-Cookie": cookieHeader(makeToken(env), SESSION_HOURS * 3600) });
    }
    if (route === "logout" && method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
    }

    if (!validToken(readCookie(req, COOKIE), env)) return fail(401, "Please sign in.");

    if (route === "session" && method === "GET") return json({ ok: true });

    /* ----- contestants ----- */
    if (route === "contestants" && method === "GET") {
      const [{ data }, totals] = await Promise.all([
        db("debate_contestants?select=number,name,photo,poster,message,active,updated_at"),
        totalsByContestant(),
      ]);
      const known = new Set(data.map((c) => c.number));
      // Votes for numbers that aren't in the list (e.g. a removed contestant) still show up.
      const orphans = Object.keys(totals).filter((n) => !known.has(n));
      return json({
        contestants: data.sort(byNumber).map((c) => ({ ...c, ...(totals[c.number] || { votes: 0, amountKobo: 0, payments: 0 }) })),
        orphans: orphans.map((n) => ({ number: n, ...totals[n] })),
        votePrice: Number(env.VOTE_PRICE_NAIRA) || 100,
      });
    }
    if (route === "contestants" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const number = String(body.number || "").trim();
      if (!NUMBER_RE.test(number)) return fail(400, "The contestant number can only use letters, digits and dashes (up to 20).");
      const row = { number, ...contestantFields(body, { requireAll: true }) };
      try {
        const { data } = await db("debate_contestants", { method: "POST", body: row, prefer: "return=representation" });
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
      fields.updated_at = new Date().toISOString();
      const { data } = await db(`debate_contestants?number=eq.${encodeURIComponent(one[1])}`, { method: "PATCH", body: fields, prefer: "return=representation" });
      if (!data.length) return fail(404, "That contestant no longer exists.");
      await rebuild(env);
      return json({ contestant: data[0] });
    }
    if (one && method === "DELETE") {
      const { data } = await db(`debate_contestants?number=eq.${encodeURIComponent(one[1])}`, { method: "DELETE", prefer: "return=representation" });
      if (!data.length) return fail(404, "That contestant no longer exists.");
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
      const filter = paymentFilter(url);
      const qs = ["select=reference,contestant_number,votes,amount_kobo,email,paid_at", ...filter, "order=paid_at.desc", `limit=${limit}`, `offset=${offset}`].join("&");
      const { data, headers } = await db(`debate_votes?${qs}`, { prefer: "count=exact" });
      const total = Number((headers.get("content-range") || "").split("/")[1]) || 0;
      return json({ payments: data, total, limit, offset });
    }
    if (route === "payments.csv" && method === "GET") {
      const filter = paymentFilter(url);
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const qs = ["select=paid_at,reference,contestant_number,votes,amount_kobo,email", ...filter, "order=paid_at.desc", "limit=1000", `offset=${offset}`].join("&");
        const { data } = await db(`debate_votes?${qs}`);
        rows.push(...data);
        if (data.length < 1000) break;
      }
      const lines = [["Paid at", "Reference", "Contestant", "Votes", "Amount (NGN)", "Email"].join(",")];
      for (const r of rows) lines.push([r.paid_at, r.reference, r.contestant_number, r.votes, (Number(r.amount_kobo) / 100).toFixed(2), r.email].map(csvCell).join(","));
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response("﻿" + lines.join("\r\n") + "\r\n", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="rhex-debate-payments-${stamp}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return fail(404, "Not found");
  } catch (err) {
    if (err.expose) return fail(err.status, err.message);
    console.error("admin api:", err);
    return fail(500, "Something went wrong on the server. Please try again.");
  }
};
