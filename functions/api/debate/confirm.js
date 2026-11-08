// /api/debate/confirm on Cloudflare Pages (handler in netlify/functions/debate-confirm.mjs).
import handler from "../../../netlify/functions/debate-confirm.mjs";
import { pagesHandler } from "../../../cloudflare/adapter.mjs";

export const onRequest = pagesHandler(handler);
