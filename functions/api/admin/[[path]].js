// /api/admin/* on Cloudflare Pages (handler in netlify/functions/admin-api.mjs).
import handler from "../../../netlify/functions/admin-api.mjs";
import { pagesHandler } from "../../../cloudflare/adapter.mjs";

export const onRequest = pagesHandler(handler);
