# RHEX Reality Debate Show (The President)

Static pages, no build step. They share the main site's logo (`../assets/img/rhex-logo.png`), brand colours, fonts and the `rhex-theme` light/dark setting.

| Page | URL |
| --- | --- |
| Show page with all contestants | `/debate/` |
| Find a contestant by code or name | `/debate/contestant/` |
| A contestant's shareable voting page | `/debate/contestant/<number>` (e.g. `/debate/contestant/1120`) |
| Live vote totals (JSON) | `/api/debate/tally` |

## Managing contestants (admin dashboard)

Go to **https://rhexlimited.com/admin/** and sign in with the admin password. There you can:

- add, edit, hide or delete contestants, and upload their photo and poster from your phone (pictures are shrunk automatically),
- see live vote totals, money received and the ranking,
- browse and search every confirmed payment, and download them as a CSV for Excel.

Contestants are stored in Supabase (`debate_contestants`), and photos in the public Storage bucket `debate-contestants`. The voting pages load the list live from `/api/debate/contestants`, so a change shows on the site within about 15 seconds. **Hide** takes a contestant off the site but keeps everything; **Delete** removes them from the list (their payment records stay).

The list in `data/contestants.js` is now only a fallback for when the live list can't be loaded. Settings such as the vote price and Paystack public key are still in that file.

Each contestant's own page (`/debate/contestant/<number>`, with its WhatsApp/Facebook preview) is written at deploy time by `build-contestants.mjs`, which reads the list from Supabase. A contestant added in the dashboard can be voted for straight away; their link preview shows their name and photo after the next deploy. To make that automatic, create a deploy hook in Cloudflare Pages (**Settings → Builds → Deploy hooks**) and save its URL as `DEBATE_BUILD_HOOK_URL`.

Admin setup: run `supabase/debate_admin.sql` once in Supabase, then add `ADMIN_PASSWORD` (10+ characters) in Netlify's environment variables and redeploy. Eight wrong passwords from one connection lock it out for 15 minutes. Sessions last 12 hours; changing the password signs everyone out.

## Going live: one-time setup

Everything below is free-tier. Allow about 20 minutes.

### 1. Supabase (stores the votes)
1. Create a free project at supabase.com.
2. Open **SQL Editor → New query**, paste the contents of `supabase/debate_votes.sql`, and click **Run**.
3. In **Project settings → API**, copy the **Project URL** and the **service_role** key. Keep the service_role key private.

### 2. Cloudflare Pages (hosts the site and runs the vote counter)
Follow **Deploy (Cloudflare Pages)** in the root `README.md`. These variables are the ones the vote counter needs:

| Name | Value |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | your `sk_live_…` key from Paystack (secret) |
| `SUPABASE_URL` | the Project URL from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key from step 1 (secret) |
| `VOTE_PRICE_NAIRA` | `100` (must match `votePrice` in `data/contestants.js`) |
| `DEBATE_TALLY_HIDDEN` | optional. Set it to `true` to hide vote counts, for example during the final days. |

### 3. Paystack
1. Put your **public** key (`pk_live_…`) in `paystackPublicKey` in `data/contestants.js`. Never put the secret key in website files.
2. In **Paystack Dashboard → Settings → API Keys & Webhooks**, set the **Live Webhook URL** to `https://rhexlimited.com/api/debate/paystack-webhook`.

## How a vote is counted

1. A voter pays on the contestant's page. The Paystack reference starts with `RHEX-PRES-<number>-`, and the metadata carries the contestant number.
2. Paystack calls the webhook (`netlify/functions/debate-paystack-webhook.mjs`). The webhook checks Paystack's signature, ignores anything that isn't a successful debate payment, and counts votes from the **amount actually paid** (amount ÷ ₦100). It does not trust the number the browser sent.
3. Each Paystack reference is stored once, so a Paystack retry never double-counts.
4. The pages read totals from `/api/debate/tally`, which is cached for 15 seconds, and refresh them every 30 seconds. Live standings appear on `/debate/`, and each contestant page shows its count and position.

Every payment is also visible in the Paystack dashboard. For a full audit, export the `debate_votes` table from Supabase.

## Automatic Paystack sync

Every 5 minutes, a Supabase `pg_cron` job (`supabase/debate_sync_schedule.sql`) calls `/api/debate/sync`. That endpoint lists the last two days of successful Paystack payments and records any the website is missing. Payments are matched by their Paystack reference, so none is ever counted twice. It runs only while **Admin → Paystack sync → Also sync automatically** is on, and each sync that adds votes appears in the Activity log. Cloudflare Pages has no scheduler of its own, which is why the schedule lives in Supabase.
