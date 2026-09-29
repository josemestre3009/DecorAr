import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";

process.env.SUPABASE_SERVICE_ROLE_KEY ||= "BUILD_SERVICE_ROLE_SENTINEL_93F4";
process.env.CLOUDINARY_URL ||= "cloudinary://BUILD_CLOUDINARY_SENTINEL_71B2";

const nextBin = process.platform === "win32" ? "next.cmd" : "next";
const build = spawnSync(nextBin, ["build"], {
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

await import("./scan-client-secrets.mjs");

await mkdir(".next/standalone/.next", { recursive: true });
await rm(".next/standalone/.next/static", { force: true, recursive: true });
await rm(".next/standalone/public", { force: true, recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
await cp("public", ".next/standalone/public", { recursive: true });
