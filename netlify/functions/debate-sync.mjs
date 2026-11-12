// Scheduled Paystack sync for the RHEX Reality Debate Show.
// POST (or GET) /api/debate/sync → { ran, added, votes }
//
// A Supabase pg_cron job calls this every 5 minutes (supabase/debate_sync_schedule.sql),
// because Cloudflare Pages has no scheduler of its own. Each call lists recent successful
// payments on Paystack and records any the website is missing, matched by the Paystack
// reference, so a payment can never be counted twice.
//
// It needs no password: it only ever records payments that Paystack itself lists as
// successful, it runs at most once every few minutes across the whole site (a lock in
// debate_settings.last_paystack_sync), and only while an admin has automatic sync
// switched on (Admin → Paystack sync). The response holds counts only, no voter details.
import { configured } from "../lib/debate-db.mjs";
import { syncIfDue } from "../lib/paystack-sync.mjs";

export const config = { path: "/api/debate/sync" };

export default async () => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const env = process.env;
  if (!configured(env) || !env.PAYSTACK_SECRET_KEY) {
    return new Response(JSON.stringify({ ran: false, reason: "not configured" }), { status: 503, headers });
  }
  try {
    // 4-minute lock so a 5-minute schedule never skips a run because of clock jitter.
    const r = await syncIfDue(env, { everyMinutes: 4, days: 2 });
    if (!r) return new Response(JSON.stringify({ ran: false, reason: "not due or switched off" }), { headers });
    return new Response(JSON.stringify({ ran: true, checked: r.debate, added: r.added.length, votes: r.votes }), { headers });
  } catch (err) {
    console.error("scheduled paystack sync:", err.message);
    return new Response(JSON.stringify({ ran: false, reason: "error" }), { status: 502, headers });
  }
};
