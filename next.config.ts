import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Two build modes:
  // - default  → "standalone" server bundle (local `npm start`, container deploys)
  // - STATIC_EXPORT=1 (npm run build:static) → "export" writes a fully static
  //   site to ./out for classic Firebase Hosting / any static host.
  // The app itself is 100% client-side (local-first store + Firebase JS SDK),
  // so the exported site is feature-complete.
  output: process.env.STATIC_EXPORT === "1" ? "export" : "standalone",
  reactStrictMode: false,
};

export default nextConfig;
