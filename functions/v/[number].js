// Short one-tap vote links: rhexlimited.com/v/1120 shows /debate/vote/1120/.
// A contestant added in /admin/ before the next deploy has no page yet, so
// they get /debate/vote/_any/, which reads the number from the address.
const NUMBER_RE = /^[A-Za-z0-9-]{1,20}$/;

export async function onRequest({ request, params, env }) {
  const number = String(params.number || "");
  const url = new URL(request.url);
  if (NUMBER_RE.test(number) && number !== "_any") {
    url.pathname = `/debate/vote/${number}/`;
    const page = await env.ASSETS.fetch(new Request(url, request));
    if (page.ok) return page;
  }
  url.pathname = "/debate/vote/_any/";
  return env.ASSETS.fetch(new Request(url, request));
}
