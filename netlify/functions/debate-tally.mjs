// Public vote totals for the RHEX Reality Debate Show (The President).
// GET /api/debate/tally → { hidden: false, updatedAt, scope, round, totals: { "1120": 57, ... } }
//
// Admins hide the counts or switch the leaderboard to "this round only" at /admin/
// (Show controls). DEBATE_TALLY_HIDDEN=true in Netlify also hides them.
// Votes are always recorded; the pages just stop showing numbers.
//
// If an admin has switched on automatic Paystack sync, each request may also start
// one in the background (at most once every 5 minutes across the whole site), so
// a payment whose webhook never arrived is still counted within minutes. See ../lib/paystack-sync.mjs.
import { db, configured, getSettings } from "../lib/debate-db.mjs";
import { syncIfDue } from "../lib/paystack-sync.mjs";

export const config = { path: "/api/debate/tally" };

export default async (req, context) => {
  const env = process.env;
  // Background only: never slows down or breaks the tally itself.
  if (configured(env) && context && typeof context.waitUntil === "function") {
    context.waitUntil(syncIfDue(env).catch((e) => console.error("paystack sync:", e.message)));
  }
  const headers = {
    "Content-Type": "application/json",
    // Short cache so a busy page doesn't hit the database on every view.
    "Cache-Control": "public, max-age=15, s-maxage=15",
  };
  if (String(env.DEBATE_TALLY_HIDDEN || "").toLowerCase() === "true") {
    return new Response(JSON.stringify({ hidden: true }), { headers });
  }
  if (!configured(env)) {
    return new Response(JSON.stringify({ error: "not configured" }), { status: 503, headers });
  }
  try {
    const s = await getSettings(env);
    if (s.tally_hidden) return new Response(JSON.stringify({ hidden: true }), { headers });
    const roundOnly = s.leaderboard_scope === "round" && s.round_started_at;
    const { data } = await db("rpc/debate_totals", { method: "POST", body: { since: roundOnly ? s.round_started_at : null } }, env);
    const totals = {};
    for (const r of data) totals[r.contestant_number] = Math.max(0, Number(r.votes) || 0);
    return new Response(JSON.stringify({
      hidden: false, updatedAt: new Date().toISOString(),
      scope: roundOnly ? "round" : "total", round: s.round_name || null, totals,
    }), { headers });
  } catch (err) {
    console.error("debate tally:", err.message);
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 502, headers });
  }
};
