import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

// dependency-cruiser requires the compiler API, which TypeScript 7 no longer exposes.
// Reuse knowledge's documented TypeScript 6 alias only within the analysis process.
const requireCompiler = createRequire(
  new URL("../../packages/knowledge/package.json", import.meta.url),
);
const compiler = pathToFileURL(requireCompiler.resolve("typescript-compiler")).href;
const manifest = pathToFileURL(requireCompiler.resolve("typescript-compiler/package.json")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/dependency-cruiser/")) {
      if (specifier === "typescript") return { url: compiler, shortCircuit: true };
      if (specifier === "typescript/package.json") return { url: manifest, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
