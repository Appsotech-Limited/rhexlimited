// Builds one page per contestant at debate/contestant/<number>/index.html,
// so each contestant gets a clean link (/debate/contestant/1120) with its own
// WhatsApp/Facebook preview (name, number and photo).
//
// The host runs this on every deploy (Cloudflare Pages build command, or netlify.toml). To preview locally:
//   node debate/build-contestants.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = (process.env.SITE_URL || process.env.URL || "https://rhexlimited.com").replace(/\/$/, "");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(here, "data/contestants.js"), "utf8"), sandbox);
const { config = {}, contestants: fallback = [] } = sandbox.window.RHEX_DEBATE || {};

// Contestants live in Supabase (managed at /admin/). The list in data/contestants.js
// is only used when the database can't be reached (e.g. a local preview).
async function liveContestants() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { db, toPublic, byNumber } = await import("../netlify/lib/debate-db.mjs");
    const { data } = await db("debate_contestants?select=number,name,photo,poster,message&active=eq.true");
    return data.map(toPublic).sort(byNumber);
  } catch (err) {
    console.warn("Couldn't load contestants from Supabase, using data/contestants.js:", err.message);
    return null;
  }
}
const live = await liveContestants();
const contestants = live || fallback;
console.log(live ? "Contestants loaded from Supabase" : "Contestants loaded from data/contestants.js");

const template = fs.readFileSync(path.join(here, "_template/contestant.html"), "utf8");
const voteTemplate = fs.readFileSync(path.join(here, "_template/vote.html"), "utf8");
const voteRoot = path.join(here, "vote");
const outRoot = path.join(here, "contestant");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const price = Number(config.votePrice) || 100;

// Link previews (WhatsApp in particular) show a thumbnail more reliably when the
// image's type and size are declared up front, so read them from the file.
function imageSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b[0] === 0x89 && b[1] === 0x50) return { type: "image/png", w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) break;
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { type: "image/jpeg", h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  } catch {}
  return null;
}
const root = path.join(here, "..");
function imageMeta(url) {
  const local = url.startsWith(SITE + "/") ? path.join(root, decodeURI(url.slice(SITE.length + 1))) : null;
  const size = local && imageSize(local);
  let out = `  <meta property="og:image:secure_url" content="${esc(url)}">\n`;
  if (size) out += `  <meta property="og:image:type" content="${size.type}">\n` +
    `  <meta property="og:image:width" content="${size.w}">\n  <meta property="og:image:height" content="${size.h}">\n`;
  return out;
}
const logoMeta = imageMeta(`${SITE}/assets/img/rhex-logo.png`);

const seen = new Set();
for (const c of contestants) {
  const num = String(c.number || "").trim();
  if (!/^[A-Za-z0-9-]{1,20}$/.test(num)) throw new Error(`Invalid contestant number: "${c.number}"`);
  if (seen.has(num)) throw new Error(`Duplicate contestant number: ${num}`);
  seen.add(num);

  const url = `${SITE}/debate/contestant/${num}/`;
  const pic = c.poster || c.photo;
  const image = !pic ? `${SITE}/assets/img/rhex-logo.png`
    : /^https?:\/\//.test(pic) ? pic
    : `${SITE}/debate/${pic.replace(/^\/?(debate\/)?/, "")}`;
  const html = template
    .replaceAll("{{TITLE}}", esc(`Vote ${c.name} · Contestant ${num} · The President`))
    .replaceAll("{{DESCRIPTION}}", esc(`Vote for ${c.name} (Contestant ${num}) in the RHEX Reality Debate Show (The President). Each vote is ₦${price.toLocaleString("en-NG")}.`))
    .replaceAll("{{URL}}", esc(url))
    .replaceAll("{{IMAGE_META}}", imageMeta(image))
    .replaceAll("{{IMAGE}}", esc(image))
    .replaceAll("{{IMAGE_ALT}}", esc(`${c.name}, Contestant ${num}`))
    .replaceAll("{{NAME}}", esc(c.name))
    .replaceAll("{{ROBOTS}}", "index, follow, max-image-preview:large")
    .replaceAll("{{NUMBER_JSON}}", JSON.stringify(num).replace(/</g, "\\u003c"));
  fs.mkdirSync(path.join(outRoot, num), { recursive: true });
  fs.writeFileSync(path.join(outRoot, num, "index.html"), html);

  // One-tap vote page, served at /v/<number> (rewrite in netlify.toml).
  const voteHtml = voteTemplate
    .replaceAll("{{TITLE}}", esc(`Vote for ${c.name} · Contestant ${num} · The President`))
    .replaceAll("{{DESCRIPTION}}", esc(`Tap to vote for ${c.name} (Contestant ${num}) in the RHEX Reality Debate Show (The President). ₦${price.toLocaleString("en-NG")} per vote.`))
    .replaceAll("{{URL}}", esc(url))
    .replaceAll("{{SHARE_URL}}", esc(`${SITE}/v/${num}`))
    .replaceAll("{{IMAGE_META}}", imageMeta(image))
    .replaceAll("{{IMAGE}}", esc(image))
    .replaceAll("{{IMAGE_ALT}}", esc(`${c.name}, Contestant ${num}`))
    .replaceAll("{{NAME}}", esc(c.name))
    .replaceAll("{{ROBOTS}}", "noindex, follow")
    .replaceAll("{{NUMBER_JSON}}", JSON.stringify(num).replace(/</g, "\\u003c"));
  fs.mkdirSync(path.join(voteRoot, num), { recursive: true });
  fs.writeFileSync(path.join(voteRoot, num, "index.html"), voteHtml);
}

// /v/<number> for a contestant without a built page yet (e.g. just added in
// /admin/): NUMBER_JSON null makes the page read the number from the address.
const voteAny = voteTemplate
  .replaceAll("{{TITLE}}", "Vote · The President · RHEX Reality Debate Show")
  .replaceAll("{{DESCRIPTION}}", "Vote in the RHEX Reality Debate Show (The President), organised by Royal Home of Excellence.")
  .replaceAll("{{URL}}", `${SITE}/debate/`)
  .replaceAll("{{SHARE_URL}}", `${SITE}/debate/`)
  .replaceAll("{{IMAGE_META}}", logoMeta)
  .replaceAll("{{IMAGE}}", `${SITE}/assets/img/rhex-logo.png`)
  .replaceAll("{{IMAGE_ALT}}", "RHEX crest")
  .replaceAll("{{NAME}}", "")
  .replaceAll("{{ROBOTS}}", "noindex, follow")
  .replaceAll("{{NUMBER_JSON}}", "null");
fs.mkdirSync(path.join(voteRoot, "_any"), { recursive: true });
fs.writeFileSync(path.join(voteRoot, "_any", "index.html"), voteAny);

// Remove quick-vote pages for contestants no longer in the list.
if (fs.existsSync(voteRoot)) {
  for (const dir of fs.readdirSync(voteRoot)) {
    if (!seen.has(dir) && dir !== "_any") fs.rmSync(path.join(voteRoot, dir), { recursive: true, force: true });
  }
}

// Shown for /debate/contestant/<anything unknown>: Netlify uses the 404 rule in
// netlify.toml, and Cloudflare Pages serves the nearest 404.html (written below).
const generic = template
  .replaceAll("{{TITLE}}", "Contestant not found · The President")
  .replaceAll("{{DESCRIPTION}}", "Vote in the RHEX Reality Debate Show (The President), organised by Royal Home of Excellence.")
  .replaceAll("{{URL}}", `${SITE}/debate/`)
  .replaceAll("{{IMAGE_META}}", logoMeta)
  .replaceAll("{{IMAGE}}", `${SITE}/assets/img/rhex-logo.png`)
  .replaceAll("{{IMAGE_ALT}}", "RHEX crest")
  .replaceAll("{{NAME}}", "")
  .replaceAll("{{ROBOTS}}", "noindex, follow")
  // null: the page reads the number from the address, so a contestant added in
  // /admin/ works straight away, before the next deploy builds their own page.
  .replaceAll("{{NUMBER_JSON}}", "null");
fs.mkdirSync(path.join(outRoot, "_unknown"), { recursive: true });
fs.writeFileSync(path.join(outRoot, "_unknown", "index.html"), generic);
fs.writeFileSync(path.join(outRoot, "404.html"), generic);
seen.add("_unknown");

// Remove pages for contestants no longer in the list.
if (fs.existsSync(outRoot)) {
  for (const dir of fs.readdirSync(outRoot)) {
    const full = path.join(outRoot, dir);
    if (!fs.statSync(full).isDirectory()) continue; // keep contestant/index.html (the finder page)
    if (!seen.has(dir)) fs.rmSync(path.join(outRoot, dir), { recursive: true, force: true });
  }
}
// Cache-busting: the CDN lets browsers keep .js/.css for hours, so stamp each
// shared file's URL with a hash of its content. Changing contestants.js then
// reaches visitors on their next page load.
const stamped = ["data/contestants.js", "assets/debate.js", "assets/debate.css"];
const hashes = Object.fromEntries(stamped.map((f) => [f,
  crypto.createHash("sha1").update(fs.readFileSync(path.join(here, f))).digest("hex").slice(0, 10)]));
const pages = [path.join(here, "index.html"), path.join(outRoot, "index.html"),
  ...[...seen].map((d) => path.join(outRoot, d, "index.html")),
  ...[...seen].map((d) => path.join(voteRoot, d, "index.html")),
  path.join(voteRoot, "_any", "index.html")];
for (const page of pages) {
  if (!fs.existsSync(page)) continue;
  let html = fs.readFileSync(page, "utf8");
  for (const f of stamped) {
    const re = new RegExp(`(["'])${f.replace(/[.]/g, "\\.")}(\\?v=[a-f0-9]+)?(["'])`, "g");
    html = html.replace(re, `$1${f}?v=${hashes[f]}$3`);
  }
  fs.writeFileSync(page, html);
}

// sitemap.xml at the site root, listing the main pages and every contestant page.
const today = new Date().toISOString().slice(0, 10);
const urls = ["/", "/debate/", "/debate/contestant/", ...contestants.map((c) => `/debate/contestant/${String(c.number).trim()}/`)];
fs.writeFileSync(path.join(here, "..", "sitemap.xml"),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map((u) => `  <url><loc>${esc(SITE + u)}</loc><lastmod>${today}</lastmod></url>`).join("\n") +
  "\n</urlset>\n");

console.log(`Built ${contestants.length} contestant page(s) for ${SITE}`);
