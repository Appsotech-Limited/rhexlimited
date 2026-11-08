// Public vote totals for the RHEX Reality Debate Show (The President).
// GET /api/debate/tally → { hidden: false, updatedAt, scope, round, totals: { "1120": 57, ... } }
//
// Admins hide the counts or switch the leaderboard to "this round only" at /admin/
// (Show controls). DEBATE_TALLY_HIDDEN=true in Netlify also hides them.
// Votes are always recorded; the pages just stop showing numbers.
import { db, configured, getSettings } from "../lib/debate-db.mjs";

export const config = { path: "/api/debate/tally" };

export default async () => {
  const env = process.env;
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
