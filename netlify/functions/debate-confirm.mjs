// Confirms a vote payment straight after checkout, so the count updates within
// seconds even if Paystack's webhook is late, misconfigured or blocked.
// POST /api/debate/confirm  { "reference": "RHEX-PRES-1120-..." }
//
// The browser only sends the reference. We ask Paystack (with the secret key)
// whether that transaction really succeeded and how much was paid, then record it
// exactly like the webhook does. A reference is stored once, so the webhook and
// this endpoint can both run for the same payment without double-counting.
import { configured, paystack, rowFromTransaction, addFlags, REFERENCE_PREFIX } from "../lib/debate-db.mjs";
import { saveVote } from "./debate-paystack-webhook.mjs";

export const config = { path: "/api/debate/confirm" };

const REF_RE = /^[A-Za-z0-9-]{12,100}$/;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function confirmReference(reference, env = process.env, fetchImpl = fetch) {
  if (typeof reference !== "string" || !REF_RE.test(reference) || !reference.startsWith(REFERENCE_PREFIX)) {
    return { status: 400, body: { ok: false, error: "bad reference" } };
  }
  const v = await paystack(`transaction/verify/${encodeURIComponent(reference)}`, env, fetchImpl);
  if (!v.ok) return { status: 404, body: { ok: false, error: "not found" } };
  let row = rowFromTransaction(v.body.data || {}, Number(env.VOTE_PRICE_NAIRA) || 100);
  if (!row) return { status: 202, body: { ok: false, pending: true } };
  row = await addFlags(row, env, fetchImpl).catch(() => row);
  await saveVote(row, env, fetchImpl);
  return { status: 200, body: { ok: true, contestant: row.contestant_number, votes: row.votes } };
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (!configured() || !process.env.PAYSTACK_SECRET_KEY) return json({ ok: false, error: "not configured" }, 503);
  let reference;
  try { ({ reference } = await req.json()); } catch { return json({ ok: false, error: "bad request" }, 400); }
  try {
    const r = await confirmReference(reference);
    return json(r.body, r.status);
  } catch (err) {
    console.error("debate confirm:", err);
    return json({ ok: false, error: "unavailable" }, 502);
  }
};
