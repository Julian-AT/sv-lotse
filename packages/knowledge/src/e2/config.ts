export interface ScanConfig {
  readonly allowedStubFiles: readonly string[];
}
export const scanConfig: ScanConfig = Object.freeze({
  // Exact repository-relative paths only. Add build-time exceptions by review.
  // There are no stub implementations in the current repository.
  allowedStubFiles: Object.freeze([]),
});
export const scanRoots = [
  "packages/brain/src",
  "packages/guide/src",
  "packages/ui/src",
  "apps/web/src",
  "apps/mac",
] as const;
export const stubFlag = "BRAIN_ALLOW_STUBS";
