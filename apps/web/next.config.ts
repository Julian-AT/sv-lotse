import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { z } from "zod";

const distDir = z
  .string()
  .regex(/^\.next(?:\/[a-z0-9-]+)?$/)
  .default(".next")
  .parse(process.env.LOTSE_NEXT_DIST_DIR);

const config: NextConfig = {
  turbopack: {},
  output: "standalone",
  distDir,
  // Keep the workspace's routes compiled while navigating multi-screen development flows.
  onDemandEntries: { maxInactiveAge: 600_000, pagesBufferLength: 64 },
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // PDF.js resolves its worker and font assets through Node's filesystem at runtime.
  outputFileTracingIncludes: {
    "/api/**/*": [
      "../../packages/knowledge/allowlist.yaml",
      "../../packages/knowledge/ingest-sources.yaml",
      "../../packages/knowledge/data/form-policy.json",
      "../../packages/knowledge/guards/*.yaml",
      "../../packages/knowledge/synonyms.yaml",
      "../../packages/brain/node_modules/pdfjs-dist",
      "../../packages/brain/node_modules/pdfjs-dist/**/*",
      "../../node_modules/.bun/pdfjs-dist@*/node_modules/pdfjs-dist/package.json",
      "../../node_modules/pdfjs-dist/{legacy/build,cmaps,standard_fonts,wasm}/**/*",
      "../../node_modules/@napi-rs/canvas*/**/*",
      "../../node_modules/.bun/pdfjs-dist@*/node_modules/pdfjs-dist/{legacy/build,cmaps,standard_fonts,wasm}/**/*",
      "../../node_modules/.bun/@napi-rs+canvas*/node_modules/@napi-rs/**/*",
      // Bun's optional native canvas links are loaded dynamically by PDF.js for scanned pages.
      "../../node_modules/.bun/pdfjs-dist@*/node_modules/@napi-rs/canvas",
      "../../node_modules/.bun/@napi-rs+canvas@*/node_modules/@napi-rs/canvas/**/*",
      "../../node_modules/.bun/@napi-rs+canvas@*/node_modules/@napi-rs/canvas-*",
      "../../node_modules/.bun/@napi-rs+canvas-*@*/node_modules/@napi-rs/canvas-*/**/*",
    ],
    "/api/turn": [
      "../../packages/knowledge/allowlist.yaml",
      "../../packages/knowledge/synonyms.yaml",
      "../../packages/knowledge/guards/*.yaml",
    ],
    "/api/guide/booking": ["../../packages/knowledge/allowlist.yaml"],
    "/api/guide/runtime": ["../../packages/guide/dist-bundle/guide.iife.js"],
    "/guided": ["../../packages/knowledge/allowlist.yaml"],
    "/api/pdfjs/*": ["./node_modules/pdfjs-dist/{build,cmaps,standard_fonts,wasm}/**/*"],
    "/api/maplibre/worker": ["./node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"],
  },
  transpilePackages: [
    "@lotse/brain",
    "@lotse/protocol",
    "@lotse/knowledge",
    "@lotse/guide",
    "@lotse/ui",
  ],
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  webpack(webpackConfig, { isServer }) {
    if (isServer) {
      // Server new URL(..., import.meta.url) references are Node filesystem assets.
      // Webpack's browser URL shim is not accepted by node:fs and changes their base.
      webpackConfig.module ??= {};
      webpackConfig.module.parser ??= {};
      webpackConfig.module.parser.javascript = {
        ...webpackConfig.module.parser.javascript,
        url: false,
      };
    }
    return webpackConfig;
  },
  poweredByHeader: false,
};
export default config;
