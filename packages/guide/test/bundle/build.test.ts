import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { buildGuideBundle } from "../../build/bundle.ts";
import { bundleConfig } from "../../build/config.ts";

test("AC1 two independent builds produce byte-identical self-contained scripts within budget", async () => {
  const first = await buildGuideBundle();
  const second = await buildGuideBundle();

  expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  expect(first.byteLength).toBeGreaterThan(0);
  expect(first.byteLength).toBeLessThanOrEqual(bundleConfig.maxBytes);
});

test("the classic script exposes only createGuide through a single global without a module loader", async () => {
  const bytes = await buildGuideBundle();
  // An empty realm provides neither Node globals nor browser network APIs.
  const realm: Record<string, unknown> = {};
  runInNewContext(Buffer.from(bytes).toString("utf8"), realm);

  expect(Object.keys(realm)).toEqual(["__lotseGuide"]);
  expect(realm.__lotseGuide).toEqual({ createGuide: expect.any(Function) });
});

test("document-start injection exposes createGuide outside the evaluator's function scope", async () => {
  const bytes = await buildGuideBundle();
  const realm: Record<string, unknown> = {};

  // Playwright evaluates init scripts inside a function wrapper.
  runInNewContext(`(() => {\n${Buffer.from(bytes).toString("utf8")}\n})();`, realm);

  expect(Object.keys(realm)).toEqual(["__lotseGuide"]);
  expect(realm.__lotseGuide).toEqual({ createGuide: expect.any(Function) });
});

test("injection preserves the host page's Zod configuration and registry", async () => {
  const bytes = await buildGuideBundle();
  const hostConfig = Object.freeze({
    postProcessor: () => {
      throw new Error("Host configuration must never run inside the guide");
    },
  });
  const hostRegistry = Object.freeze({});
  const realm: Record<string, unknown> = {
    __zod_globalConfig: hostConfig,
    __zod_globalRegistry: hostRegistry,
  };

  runInNewContext(Buffer.from(bytes).toString("utf8"), realm);

  expect(realm.__zod_globalConfig).toBe(hostConfig);
  expect(realm.__zod_globalRegistry).toBe(hostRegistry);
  expect(realm.__lotseGuide).toEqual({ createGuide: expect.any(Function) });
});
