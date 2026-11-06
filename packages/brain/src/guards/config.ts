import { knowledgeAssetUrl } from "../config/assets.ts";

export const GUARD_CONFIG = {
  version: "guards/14",
  boundaryThreshold: 0.35,
  timeoutMs: 30_000,
  maxOutputTokens: 700,
  repairAttempts: 1,
  maxResponseCharacters: 32_000,
  dataFiles: {
    safety: knowledgeAssetUrl("guards/safety-net.yaml"),
    boundary: knowledgeAssetUrl("guards/boundary-rules.yaml"),
  },
} as const;
