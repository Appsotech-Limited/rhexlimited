// Public contestant list for the RHEX Reality Debate Show (The President).
// GET /api/debate/contestants → { contestants: [{ number, name, photo, poster, message, eliminated }],
//                                  settings: { votingOpen, closedMessage, round } }
// Only active contestants are listed. Contestants are managed at /admin/.
import { db, configured, toPublic, byNumber, getSettings } from "../lib/debate-db.mjs";

export const config = { path: "/api/debate/contestants" };

export default async () => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=15, s-maxage=15" };
  if (!configured()) return new Response(JSON.stringify({ error: "not configured" }), { status: 503, headers });
  try {
    const [{ data }, s] = await Promise.all([
      db("debate_contestants?select=number,name,photo,poster,message,eliminated&active=eq.true"),
      getSettings().catch(() => ({ voting_open: true })),
    ]);
    const settings = { votingOpen: s.voting_open !== false, closedMessage: s.closed_message || null, round: s.round_name || null };
    return new Response(JSON.stringify({ contestants: data.map(toPublic).sort(byNumber), settings }), { headers });
  } catch (err) {
    console.error("debate contestants:", err.message);
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 502, headers });
  }
};
