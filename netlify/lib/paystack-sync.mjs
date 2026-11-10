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
// Paystack filters by when a payment was started, so it lists a day earlier and
// keeps only payments completed inside the window, matching debate_votes.paid_at.
export async function paystackDebateRows(env, days, fetchImpl = fetch) {
  const since = Date.now() - days * 86400000;
  const from = new Date(since - 86400000).toISOString();
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
      if (row && Date.parse(row.paid_at) >= since) rows.push(row);
    }
    const pages = (r.body.meta && Number(r.body.meta.pageCount)) || 1;
    if (page >= pages) break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { rows, checked, truncated, since: new Date(since).toISOString() };
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
// With `references`, only those payments are recorded (the ones an admin reviewed),
// and still only if Paystack lists them as successful and we don't have them yet.
export async function syncPaystack(env, { days = 1, references = null, fetchImpl = fetch } = {}) {
  const { rows, checked, truncated } = await paystackDebateRows(env, days, fetchImpl);
  const only = references ? new Set(references) : null;
  const missing = (await missingRows(rows, env, fetchImpl)).filter((r) => !only || only.has(r.reference));
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

// Compares Paystack with the website for the last `days` days without changing anything.
export async function syncPreview(env, { days = 3, fetchImpl = fetch } = {}) {
  const { rows, truncated, since } = await paystackDebateRows(env, days, fetchImpl);
  const [{ data: ours }, { data: people }] = await Promise.all([
    db(`debate_votes?select=reference,contestant_number,votes,amount_kobo,voided,paid_at&paid_at=gte.${encodeURIComponent(since)}&limit=20000`, {}, env, fetchImpl),
    db("debate_contestants?select=number,name", {}, env, fetchImpl),
  ]);
  const names = Object.fromEntries(people.map((c) => [c.number, c.name]));
  const theirs = new Map(rows.map((r) => [r.reference, r]));
  // Payments the website has under any date, so one counted just before the window isn't "missing".
  const known = new Map(ours.map((o) => [o.reference, o]));
  for (const o of await recordedAmong(rows.filter((r) => !known.has(r.reference)), env, fetchImpl)) known.set(o.reference, o);

  const pick = (r) => ({ reference: r.reference, contestant: r.contestant_number, name: names[r.contestant_number] || null, votes: r.votes, amountKobo: r.amount_kobo, email: r.email || null, paidAt: r.paid_at });
  const missing = rows.filter((r) => !known.has(r.reference)).map(pick);
  const removed = rows.filter((r) => known.has(r.reference) && known.get(r.reference).voided).map(pick);
  const mismatched = rows.filter((r) => { const o = known.get(r.reference); return o && (o.votes !== r.votes || o.contestant_number !== r.contestant_number); })
    .map((r) => ({ ...pick(r), website: { contestant: known.get(r.reference).contestant_number, votes: known.get(r.reference).votes } }));
  const notOnPaystack = ours.filter((o) => !o.voided && !theirs.has(o.reference)).map((o) => ({ reference: o.reference, contestant: o.contestant_number, name: names[o.contestant_number] || null, votes: o.votes, amountKobo: o.amount_kobo, paidAt: o.paid_at }));

  const by = {};
  const add = (n, k, v) => { by[n] = by[n] || { number: n, name: names[n] || null, paystack: 0, website: 0, missing: 0 }; by[n][k] += v; };
  rows.forEach((r) => add(r.contestant_number, "paystack", r.votes));
  ours.filter((o) => !o.voided).forEach((o) => add(o.contestant_number, "website", o.votes));
  missing.forEach((m) => add(m.contestant, "missing", m.votes));
  const contestants = Object.values(by).map((c) => ({ ...c, difference: c.paystack - c.website, afterSync: c.website + c.missing }))
    .sort((a, b) => b.paystack - a.paystack || String(a.number).localeCompare(String(b.number)));
  const sum = (arr, k) => arr.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const live = ours.filter((o) => !o.voided);
  return {
    days, since, truncated,
    paystack: { payments: rows.length, votes: sum(rows, "votes"), amountKobo: sum(rows, "amount_kobo") },
    website: { payments: live.length, votes: sum(live, "votes"), amountKobo: sum(live, "amount_kobo") },
    contestants, missing, missingVotes: sum(missing, "votes"), mismatched, removed, notOnPaystack,
  };
}

async function recordedAmong(rows, env, fetchImpl) {
  const out = [];
  for (let i = 0; i < rows.length; i += 80) {
    const refs = rows.slice(i, i + 80).map((r) => `"${r.reference.replace(/"/g, "")}"`).join(",");
    const { data } = await db(`debate_votes?select=reference,contestant_number,votes,amount_kobo,voided,paid_at&reference=in.(${encodeURIComponent(refs)})`, {}, env, fetchImpl);
    out.push(...data);
  }
  return out;
}

// Runs syncPaystack at most once every `everyMinutes`, across all servers.
// The lock is a conditional update of debate_settings.last_paystack_sync: only the
// request that moves the timestamp forward runs the sync. Returns null when skipped.
// Only when an admin has switched on automatic sync (debate_settings.paystack_auto_sync);
// otherwise admins review differences on the Paystack sync page and apply them there.
export async function syncIfDue(env, { everyMinutes = 5, days = 2, fetchImpl = fetch } = {}) {
  if (!env.PAYSTACK_SECRET_KEY) return null;
  const now = new Date();
  const cutoff = new Date(now.getTime() - everyMinutes * 60000).toISOString();
  const { data } = await db(
    `debate_settings?id=eq.1&paystack_auto_sync=is.true&or=(last_paystack_sync.is.null,last_paystack_sync.lt.${encodeURIComponent(cutoff)})`,
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
