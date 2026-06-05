/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Provenance seam: a later agent injects element provenance (data-src on every
  // JSX element) at build time. With Next 14 + SWC the hook point is a custom
  // experimental SWC plugin declared here, OR fall back to .babelrc (see below).
  // Keeping experimental.swcPlugins available so the provenance plugin can be
  // wired without restructuring the config.
  experimental: {
    // swcPlugins: [["paikko-provenance-swc", {}]],
  },
};

module.exports = nextConfig;

// Local dev integration with the OpenNext Cloudflare adapter: makes
// `getCloudflareContext()` resolve real bindings (D1 `DB`, DO `SESSION_TRACE`)
// while running plain `next dev`, by booting wrangler's local platform proxy.
// This module is CommonJS, so we load the ESM-only helper via dynamic import.
// The helper is fire-and-forget (no await needed) and only runs during dev.
if (process.env.NODE_ENV !== "production") {
  import("@opennextjs/cloudflare")
    .then(({ initOpenNextCloudflareForDev }) => initOpenNextCloudflareForDev())
    .catch(() => {
      // If the adapter isn't installed/available, fall through: `next dev` still
      // runs, just without Cloudflare bindings (DB/DO calls will then fail until
      // you use `npm run preview`).
    });
}
