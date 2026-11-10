// Keeps the vote count in step with Paystack.
//
// Votes normally arrive through the Paystack webhook, with the browser's
// /api/debate/confirm call as a backup. Both can miss a payment (a webhook
// Paystack never delivered, a voter who closed the page), so this lists the
// successful payments on Paystack itself and records any we don't have.
// It is safe to run any number of times: rows are keyed by the Paystack
// reference and inserted with ignore-duplicates.
import { db, paystack, rowFromTransaction, addFlags } from "./debate-db.mjs";

const MAX_PAGES = 20; // 2,000 payments per run

const price = (env) => Number(env.VOTE_PRICE_NAIRA) || 100;

// Successful debate payments on Paystack from the last `days` days, as debate_votes rows.
export async function paystackDebateRows(env, days, fetchImpl = fetch) {
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const rows = [];
  let checked = 0, truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await paystack(`transaction?status=success&perPage=100&page=${page}&from=${encodeURIComponent(from)}`, env, fetchImpl);
    if (!r.ok) {
      const err = new Error(`Paystack said: ${(r.body && r.body.message) || r.status}`);
      err.status = 502;
      err.expose = true; // safe to show admins
      throw err;
    }
    const txs = r.body.data || [];
    checked += txs.length;
    for (const t of txs) {
      const row = rowFromTransaction(t, price(env));
      if (row) rows.push(row);
    }
    const pages = (r.body.meta && Number(r.body.meta.pageCount)) || 1;
    if (page >= pages) break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { rows, checked, truncated };
}

// Which of these rows have no matching debate_votes record yet.
export async function missingRows(rows, env, fetchImpl = fetch) {
  const seen = new Set();
  for (let i = 0; i < rows.length; i += 80) {
    const refs = rows.slice(i, i + 80).map((r) => `"${r.reference.replace(/"/g, "")}"`).join(",");
    const { data } = await db(`debate_votes?select=reference&reference=in.(${encodeURIComponent(refs)})`, {}, env, fetchImpl);
    data.forEach((d) => seen.add(d.reference));
  }
  return rows.filter((r) => !seen.has(r.reference));
}

// Lists Paystack, then records every payment that was missed.
// Returns { days, checked, debate, added: [{reference, contestant, votes, ...}], votes, truncated }.
export async function syncPaystack(env, { days = 1, fetchImpl = fetch } = {}) {
  const { rows, checked, truncated } = await paystackDebateRows(env, days, fetchImpl);
  const missing = await missingRows(rows, env, fetchImpl);
  const added = [];
  for (const row of missing) {
    const flagged = await addFlags({ ...row, source: "paystack_sync" }, env, fetchImpl).catch(() => ({ ...row, source: "paystack_sync" }));
    const { data } = await db("debate_votes", { method: "POST", body: flagged, prefer: "resolution=ignore-duplicates,return=representation" }, env, fetchImpl);
    if (data && data.length) {
      added.push({ reference: row.reference, contestant: row.contestant_number, votes: row.votes, amountKobo: row.amount_kobo, email: row.email, paidAt: row.paid_at });
    }
  }
  return { days, checked, debate: rows.length, added, votes: added.reduce((s, a) => s + a.votes, 0), truncated };
}

// Runs syncPaystack at most once every `everyMinutes`, across all servers.
// The lock is a conditional update of debate_settings.last_paystack_sync: only the
// request that moves the timestamp forward runs the sync. Returns null when skipped.
export async function syncIfDue(env, { everyMinutes = 5, days = 2, fetchImpl = fetch } = {}) {
  if (!env.PAYSTACK_SECRET_KEY) return null;
  const now = new Date();
  const cutoff = new Date(now.getTime() - everyMinutes * 60000).toISOString();
  const { data } = await db(
    `debate_settings?id=eq.1&or=(last_paystack_sync.is.null,last_paystack_sync.lt.${encodeURIComponent(cutoff)})`,
    { method: "PATCH", body: { last_paystack_sync: now.toISOString() }, prefer: "return=representation" },
    env, fetchImpl,
  );
  if (!data || !data.length) return null;
  const result = await syncPaystack(env, { days, fetchImpl });
  if (result.added.length) {
    await db("debate_admin_log", {
      method: "POST", prefer: "return=minimal",
      body: { action: "paystack_sync", target: null, details: { auto: true, days, checked: result.debate, added: result.added.length, votes: result.votes, references: result.added.map((a) => a.reference) } },
    }, env, fetchImpl).catch((e) => console.error("audit log:", e.message));
  }
  return result;
}
