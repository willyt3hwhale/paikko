/**
 * Worker entry for Cloudflare (OpenNext).
 *
 * OpenNext generates the real request handler at `.open-next/worker.js` during
 * `opennextjs-cloudflare build`. We can't point wrangler's `main` straight at it,
 * though, because the Worker must also EXPORT the `SessionTrace` Durable Object
 * class (a DO namespace binding is only valid if a class of that name is exported
 * from the Worker's entry module). So this thin custom entry re-exports OpenNext's
 * fetch handler as the default export and additionally exports `SessionTrace`.
 *
 * `wrangler.jsonc` -> `"main": "worker.ts"`. The `.open-next/worker.js` import is
 * resolved at build time (it does not exist until `opennextjs-cloudflare build`
 * has run), hence the `@ts-ignore`.
 */

// @ts-ignore `.open-next/worker.js` is generated at build time by OpenNext.
import { default as handler } from "./.open-next/worker.js";

// OpenNext 1.x's generated worker exports an object with a `fetch` method
// (`export default { fetch }`), so we forward `fetch` explicitly rather than
// re-exporting the module default wholesale.
export default {
  fetch: handler.fetch,
} satisfies ExportedHandler<CloudflareEnv>;

export { SessionTrace } from "./src/paikko/server/sessionTraceDO";
