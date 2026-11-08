// Builds one page per contestant at debate/contestant/<number>/index.html,
// so each contestant gets a clean link (/debate/contestant/1120) with its own
// WhatsApp/Facebook preview (name, number and photo).
//
// Netlify runs this on every deploy (see netlify.toml). To preview locally:
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
const { config = {}, contestants = [] } = sandbox.window.RHEX_DEBATE || {};

const template = fs.readFileSync(path.join(here, "_template/contestant.html"), "utf8");
const voteTemplate = fs.readFileSync(path.join(here, "_template/vote.html"), "utf8");
const voteRoot = path.join(here, "vote");
const outRoot = path.join(here, "contestant");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const price = Number(config.votePrice) || 100;

const seen = new Set();
for (const c of contestants) {
  const num = String(c.number || "").trim();
  if (!/^[A-Za-z0-9-]{1,20}$/.test(num)) throw new Error(`Invalid contestant number: "${c.number}"`);
  if (seen.has(num)) throw new Error(`Duplicate contestant number: ${num}`);
  seen.add(num);

  const url = `${SITE}/debate/contestant/${num}/`;
  const pic = c.poster || c.photo;
  const image = pic ? `${SITE}/debate/${pic.replace(/^\/?(debate\/)?/, "")}` : `${SITE}/assets/img/rhex-logo.png`;
  const html = template
    .replaceAll("{{TITLE}}", esc(`Vote ${c.name} · Contestant ${num} · The President`))
    .replaceAll("{{DESCRIPTION}}", esc(`Vote for ${c.name} (Contestant ${num}) in the RHEX Reality Debate Show (The President). Each vote is ₦${price.toLocaleString("en-NG")}.`))
    .replaceAll("{{URL}}", esc(url))
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
    .replaceAll("{{IMAGE}}", esc(image))
    .replaceAll("{{IMAGE_ALT}}", esc(`${c.name}, Contestant ${num}`))
    .replaceAll("{{NAME}}", esc(c.name))
    .replaceAll("{{ROBOTS}}", "noindex, follow")
    .replaceAll("{{NUMBER_JSON}}", JSON.stringify(num).replace(/</g, "\\u003c"));
  fs.mkdirSync(path.join(voteRoot, num), { recursive: true });
  fs.writeFileSync(path.join(voteRoot, num, "index.html"), voteHtml);
}

// Remove quick-vote pages for contestants no longer in the list.
if (fs.existsSync(voteRoot)) {
  for (const dir of fs.readdirSync(voteRoot)) {
    if (!seen.has(dir)) fs.rmSync(path.join(voteRoot, dir), { recursive: true, force: true });
  }
}

// Shown for /debate/contestant/<anything unknown> (see the 404 rule in netlify.toml).
const generic = template
  .replaceAll("{{TITLE}}", "Contestant not found · The President")
  .replaceAll("{{DESCRIPTION}}", "Vote in the RHEX Reality Debate Show (The President), organised by Royal Home of Excellence.")
  .replaceAll("{{URL}}", `${SITE}/debate/`)
  .replaceAll("{{IMAGE}}", `${SITE}/assets/img/rhex-logo.png`)
  .replaceAll("{{IMAGE_ALT}}", "RHEX crest")
  .replaceAll("{{NAME}}", "")
  .replaceAll("{{ROBOTS}}", "noindex, follow")
  .replaceAll("{{NUMBER_JSON}}", '"__none__"');
fs.mkdirSync(path.join(outRoot, "_unknown"), { recursive: true });
fs.writeFileSync(path.join(outRoot, "_unknown", "index.html"), generic);
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
  ...[...seen].map((d) => path.join(voteRoot, d, "index.html"))];
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
