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
