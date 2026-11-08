// Paystack webhook for the RHEX Reality Debate Show (The President).
//
// Paystack calls this URL after every successful payment. We check that the
// request really came from Paystack (HMAC signature with the secret key), keep
// only payments made from the debate voting pages, work out the number of votes
// from the amount actually paid, and record it in Supabase. Each Paystack
// reference is stored once, so retries never double-count.
//
// Environment variables (set in Netlify → Site configuration → Environment variables):
//   PAYSTACK_SECRET_KEY        sk_live_… (never put this in the website files)
//   SUPABASE_URL               https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role key from Supabase → Project settings → API
//   VOTE_PRICE_NAIRA           optional, defaults to 100. Must match votePrice in debate/data/contestants.js
import crypto from "node:crypto";
import { rowFromTransaction, addFlags } from "../lib/debate-db.mjs";

export const config = { path: "/api/debate/paystack-webhook" };

export function validSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Turns a Paystack charge.success event into a vote row, or returns null if it isn't a debate vote.
export function voteFromEvent(event, priceNaira) {
  if (!event || event.event !== "charge.success") return null;
  return rowFromTransaction(event.data || {}, priceNaira);
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export async function saveVote(row, env = process.env, fetchImpl = fetch) {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/debate_votes`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      // Same reference twice (Paystack retries) is silently ignored.
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase insert failed: ${res.status} ${await res.text()}`);
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const env = process.env;
  if (!env.PAYSTACK_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("debate webhook: missing environment variables");
    return new Response("Not configured", { status: 500 });
  }

  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-paystack-signature"), env.PAYSTACK_SECRET_KEY)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = safeJson(raw);
  let row = voteFromEvent(event, Number(env.VOTE_PRICE_NAIRA) || 100);
  if (!row) return new Response("Ignored", { status: 200 });
  row = await addFlags(row, env).catch(() => row);

  try {
    await saveVote(row, env);
  } catch (err) {
    console.error(err);
    // A non-200 makes Paystack retry later, which is what we want if the database hiccups.
    return new Response("Could not record vote", { status: 500 });
  }
  return new Response("OK", { status: 200 });
};
