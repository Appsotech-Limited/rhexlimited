# RHEX Reality Debate Show (The President)

Static pages, no build step. They share the main site's logo (`../assets/img/rhex-logo.png`), brand colours, fonts and the `rhex-theme` light/dark setting.

| Page | URL |
| --- | --- |
| Show page with all contestants | `/debate/` |
| Find a contestant by code or name | `/debate/contestant/` |
| A contestant's shareable voting page | `/debate/contestant/<number>` (e.g. `/debate/contestant/1120`) |
| Live vote totals (JSON) | `/api/debate/tally` |

## Adding a contestant

Edit `data/contestants.js` and copy one block in `contestants`. On the next deploy Netlify runs `node debate/build-contestants.mjs`, which writes `debate/contestant/<number>/index.html` for every contestant (with their own WhatsApp/Facebook link preview). Run it yourself to preview locally. Edit the page design in `_template/contestant.html`, never the generated copies. Put photos in `debate/assets/contestants/` and set `photo` to e.g. `"assets/contestants/1120.jpg"` (portrait, 4:5 works best). Without a photo, a gold monogram is shown.

## Going live: one-time setup

Everything below is free-tier. Allow about 20 minutes.

### 1. Supabase (stores the votes)
1. Create a free project at supabase.com.
2. Open **SQL Editor → New query**, paste the contents of `supabase/debate_votes.sql`, and click **Run**.
3. In **Project settings → API**, copy the **Project URL** and the **service_role** key. Keep the service_role key private.

### 2. Netlify (hosts the site and runs the vote counter)
1. At netlify.com, choose **Add new site → Import an existing project**, then pick this GitHub repo and the `main` branch. The build settings are read from `netlify.toml`.
2. In **Site configuration → Environment variables**, add:
   | Name | Value |
   | --- | --- |
   | `PAYSTACK_SECRET_KEY` | your `sk_live_…` key from Paystack |
   | `SUPABASE_URL` | the Project URL from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role key from step 1 |
   | `VOTE_PRICE_NAIRA` | `100` (must match `votePrice` in `data/contestants.js`) |
   | `DEBATE_TALLY_HIDDEN` | optional. Set it to `true` to hide vote counts, for example during the final days. |
3. Point **rhexlimited.org** at the site under **Domain management**, then redeploy.

### 3. Paystack
1. Put your **public** key (`pk_live_…`) in `paystackPublicKey` in `data/contestants.js`. Never put the secret key in website files.
2. In **Paystack Dashboard → Settings → API Keys & Webhooks**, set the **Live Webhook URL** to `https://www.rhexlimited.org/api/debate/paystack-webhook`.

## How a vote is counted

1. A voter pays on the contestant's page. The Paystack reference starts with `RHEX-PRES-<number>-`, and the metadata carries the contestant number.
2. Paystack calls the webhook (`netlify/functions/debate-paystack-webhook.mjs`). The webhook checks Paystack's signature, ignores anything that isn't a successful debate payment, and counts votes from the **amount actually paid** (amount ÷ ₦100). It does not trust the number the browser sent.
3. Each Paystack reference is stored once, so a Paystack retry never double-counts.
4. The pages read totals from `/api/debate/tally`, which is cached for 15 seconds, and refresh them every 30 seconds. Live standings appear on `/debate/`, and each contestant page shows its count and position.

Every payment is also visible in the Paystack dashboard. For a full audit, export the `debate_votes` table from Supabase.
