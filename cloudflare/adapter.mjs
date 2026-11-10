// Runs the existing handlers in netlify/functions/ on Cloudflare Pages Functions.
//
// Those handlers already use the standard Request/Response API. They read
// settings from process.env and take an optional { ip, waitUntil } context. On Cloudflare,
// settings arrive per request as `env` bindings, so they're copied into
// process.env (available through the nodejs_compat flag in wrangler.toml) before
// each call.
export function pagesHandler(handler) {
  return async ({ request, env, waitUntil }) => {
    if (!globalThis.process) globalThis.process = { env: {} };
    if (!globalThis.process.env) globalThis.process.env = {};
    for (const [key, value] of Object.entries(env || {})) {
      if (typeof value === "string") globalThis.process.env[key] = value;
    }
    const ip = request.headers.get("cf-connecting-ip") || undefined;
    // waitUntil lets a handler finish background work (the Paystack sync) after responding.
    return handler(request, { ip, waitUntil: typeof waitUntil === "function" ? waitUntil : undefined });
  };
}
