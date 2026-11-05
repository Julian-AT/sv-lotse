export interface ScanConfig {
  readonly allowedStubFiles: readonly string[];
}
export const scanConfig: ScanConfig = Object.freeze({
  // Exact repository-relative paths only. Add build-time exceptions by review.
  allowedStubFiles: Object.freeze([
    "packages/brain/src/config/index.ts",
    "packages/brain/test/runtime/contracts.test.ts",
    // Scanner vocabulary and isolated regression fixtures; neither enables stubs.
    "packages/knowledge/src/e2/config.ts",
    "packages/knowledge/test/e2/scan.test.ts",
  ]),
});
export const scanRoots = [
  "packages/brain/src",
  "packages/guide/src",
  "packages/ui/src",
  "apps/web/src",
  "apps/mac",
] as const;
export const stubFlag = "BRAIN_ALLOW_STUBS";
