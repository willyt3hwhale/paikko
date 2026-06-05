/**
 * OpenNext Cloudflare adapter config.
 *
 * paikko's tickets live in D1 (queried via Prisma) and the trace buffer lives in
 * our own `SessionTrace` Durable Object - neither needs OpenNext's optional
 * incremental-cache / tag-cache overrides, so we keep the default in-memory cache.
 * If/when the app adds ISR or on-demand revalidation, swap `incrementalCache` for
 * the R2 or D1 override (see https://opennext.js.org/cloudflare/caching).
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
