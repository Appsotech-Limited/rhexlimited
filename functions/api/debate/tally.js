// /api/debate/tally on Cloudflare Pages (handler in netlify/functions/debate-tally.mjs).
import handler from "../../../netlify/functions/debate-tally.mjs";
import { pagesHandler } from "../../../cloudflare/adapter.mjs";

export const onRequest = pagesHandler(handler);
