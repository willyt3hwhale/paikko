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

export default handler;

export { SessionTrace } from "./src/paikko/server/sessionTraceDO";
