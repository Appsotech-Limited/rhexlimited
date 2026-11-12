// /api/debate/sync on Cloudflare Pages (handler in netlify/functions/debate-sync.mjs).
// Called every 5 minutes by a Supabase pg_cron job (supabase/debate_sync_schedule.sql).
import handler from "../../../netlify/functions/debate-sync.mjs";
import { pagesHandler } from "../../../cloudflare/adapter.mjs";

export const onRequest = pagesHandler(handler);
