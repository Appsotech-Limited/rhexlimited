// Public contestant list for the RHEX Reality Debate Show (The President).
// GET /api/debate/contestants → { contestants: [{ number, name, photo, poster, message }] }
// Only active contestants are listed. Contestants are managed at /admin/.
import { db, configured, toPublic, byNumber } from "../lib/debate-db.mjs";

export const config = { path: "/api/debate/contestants" };

export default async () => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=15, s-maxage=15" };
  if (!configured()) return new Response(JSON.stringify({ error: "not configured" }), { status: 503, headers });
  try {
    const { data } = await db("debate_contestants?select=number,name,photo,poster,message&active=eq.true");
    return new Response(JSON.stringify({ contestants: data.map(toPublic).sort(byNumber) }), { headers });
  } catch (err) {
    console.error("debate contestants:", err.message);
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 502, headers });
  }
};
