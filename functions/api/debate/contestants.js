// /api/debate/contestants on Cloudflare Pages (handler in netlify/functions/debate-contestants.mjs).
import handler from "../../../netlify/functions/debate-contestants.mjs";
import { pagesHandler } from "../../../cloudflare/adapter.mjs";

export const onRequest = pagesHandler(handler);
