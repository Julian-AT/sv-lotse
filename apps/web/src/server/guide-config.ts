import { resolve } from "node:path";

// Both run-next and start-standalone run with apps/web as cwd. The standalone
// output retains this monorepo layout via outputFileTracingIncludes.
export const GUIDE_ASSET_PATHS = {
  bundle: resolve(process.cwd(), "../../packages/guide/dist-bundle/guide.iife.js"),
  policy: resolve(process.cwd(), "../../packages/knowledge/allowlist.yaml"),
} as const;
