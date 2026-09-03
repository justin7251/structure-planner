/*
 * Cross-platform static-export build (no inline env vars — works the same in
 * PowerShell, cmd, and bash). Sets STATIC_EXPORT=1 and runs `next build`,
 * which writes the deployable static site to ./out.
 *
 * Usage:  npm run build:static
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

process.env.STATIC_EXPORT = "1";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
