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

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = (process.env.SITE_URL || process.env.URL || "https://www.rhexlimited.com").replace(/\/$/, "");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(here, "data/contestants.js"), "utf8"), sandbox);
const { config = {}, contestants = [] } = sandbox.window.RHEX_DEBATE || {};

const template = fs.readFileSync(path.join(here, "_template/contestant.html"), "utf8");
const outRoot = path.join(here, "contestant");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const price = Number(config.votePrice) || 100;

const seen = new Set();
for (const c of contestants) {
  const num = String(c.number || "").trim();
  if (!/^[A-Za-z0-9-]{1,20}$/.test(num)) throw new Error(`Invalid contestant number: "${c.number}"`);
  if (seen.has(num)) throw new Error(`Duplicate contestant number: ${num}`);
  seen.add(num);

  const url = `${SITE}/debate/contestant/${num}`;
  const pic = c.poster || c.photo;
  const image = pic ? `${SITE}/debate/${pic.replace(/^\/?(debate\/)?/, "")}` : `${SITE}/assets/img/rhex-logo.png`;
  const html = template
    .replaceAll("{{TITLE}}", esc(`Vote ${c.name} · Contestant ${num} · The President`))
    .replaceAll("{{DESCRIPTION}}", esc(`Vote for ${c.name} (Contestant ${num}) in the RHEX Reality Debate Show (The President). Each vote is ₦${price.toLocaleString("en-NG")}.`))
    .replaceAll("{{URL}}", esc(url))
    .replaceAll("{{IMAGE}}", esc(image))
    .replaceAll("{{NUMBER_JSON}}", JSON.stringify(num).replace(/</g, "\\u003c"));
  fs.mkdirSync(path.join(outRoot, num), { recursive: true });
  fs.writeFileSync(path.join(outRoot, num, "index.html"), html);
}

// Shown for /debate/contestant/<anything unknown> (see the 404 rule in netlify.toml).
const generic = template
  .replaceAll("{{TITLE}}", "Contestant not found · The President")
  .replaceAll("{{DESCRIPTION}}", "Vote in the RHEX Reality Debate Show (The President), organised by Royal Home of Excellence.")
  .replaceAll("{{URL}}", `${SITE}/debate/`)
  .replaceAll("{{IMAGE}}", `${SITE}/assets/img/rhex-logo.png`)
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
console.log(`Built ${contestants.length} contestant page(s) for ${SITE}`);
