// Public vote totals for the RHEX Reality Debate Show (The President).
// GET /api/debate/tally → { hidden: false, updatedAt, totals: { "1120": 57, ... } }
//
// Set DEBATE_TALLY_HIDDEN=true in Netlify to hide the counts (e.g. for the final
// days). Votes are still recorded; the pages just stop showing numbers.
export const config = { path: "/api/debate/tally" };

export default async (req) => {
  const env = process.env;
  const headers = {
    "Content-Type": "application/json",
    // Short cache so a busy page doesn't hit the database on every view.
    "Cache-Control": "public, max-age=15, s-maxage=15",
  };

  if (String(env.DEBATE_TALLY_HIDDEN || "").toLowerCase() === "true") {
    return new Response(JSON.stringify({ hidden: true }), { headers });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "not configured" }), { status: 503, headers });
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/debate_vote_totals?select=contestant_number,votes`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    console.error("debate tally:", res.status, await res.text());
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 502, headers });
  }

  const totals = {};
  for (const r of await res.json()) totals[r.contestant_number] = Number(r.votes) || 0;
  return new Response(JSON.stringify({ hidden: false, updatedAt: new Date().toISOString(), totals }), { headers });
};
