// /api/debate/paystack-webhook on Cloudflare Pages (handler in netlify/functions/debate-paystack-webhook.mjs).
import handler from "../../../netlify/functions/debate-paystack-webhook.mjs";
import { pagesHandler } from "../../../cloudflare/adapter.mjs";

export const onRequest = pagesHandler(handler);
