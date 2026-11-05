// ADR 0013 and PRD section 17. Baseline entries identify individual edges, not folders.
module.exports = {
  forbidden: [
    {
      name: "db-is-a-leaf",
      severity: "error",
      from: { path: "^packages/db/" },
      to: { path: "^(packages|apps)/", pathNot: "^packages/db/" },
    },
    {
      name: "knowledge-no-brain-runtime",
      severity: "error",
      from: { path: "^packages/knowledge/" },
      to: { path: "^packages/brain/", preCompilationOnly: false },
    },
    {
      name: "packages-no-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "workspace-public-exports-only",
      severity: "error",
      from: { path: "^((?:packages|apps)/[^/]+)/" },
      to: {
        path: "^(?:packages|apps)/[^/]+/src/",
        pathNot: "^$1/",
        dependencyTypesNot: ["aliased-workspace"],
      },
    },
    {
      name: "scripts-public-exports-only",
      severity: "error",
      from: { path: "^scripts/" },
      to: { path: "^(?:packages|apps)/[^/]+/src/", dependencyTypesNot: ["aliased-workspace"] },
    },
    {
      name: "no-unresolved-workspace-imports",
      severity: "error",
      from: {},
      to: { path: "^@lotse/", couldNotResolve: true },
    },
    {
      name: "no-circular-imports-in-package",
      severity: "error",
      from: { path: "^((?:packages|apps)/[^/]+)/" },
      to: { path: "^$1/", circular: true, viaOnly: { path: "^$1/" } },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^apps/mac/|/(?:node_modules|generated|drizzle|dist|coverage|\\.next)/)" },
    combinedDependencies: true,
    tsPreCompilationDeps: "specify",
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default"],
    },
  },
};
