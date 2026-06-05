/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @paikko/widget ships raw TS/TSX source (its package "exports" point at
  // ./src), so Next must transpile it alongside the app. @paikko/contract is
  // pre-built to dist/, but transpiling it too is harmless and keeps the
  // workspace wiring uniform.
  transpilePackages: ["@paikko/widget", "@paikko/contract"],
};

module.exports = nextConfig;
