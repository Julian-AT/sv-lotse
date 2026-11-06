import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { z } from "zod";
import loginPages from "../data/portal-login-pages.json" with { type: "json" };
import { AllowlistSchema, DateSchema, Text } from "./schemas/common.ts";

/** Load only the versioned portal policy, without catalog/database dependencies. */
export async function loadPortalPolicy(
  path: string | URL = new URL("../allowlist.yaml", import.meta.url),
): Promise<z.infer<typeof AllowlistSchema>> {
  // Web hosts trace the single policy file explicitly; a caller-supplied path
  // must not cause the bundler to include the entire repository.
  const source = await readFile(/* turbopackIgnore: true */ path, "utf8");
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length || document.warnings.length) throw new Error("Invalid portal policy");
  return AllowlistSchema.parse(document.toJS({ maxAliasCount: 100 }));
}

const loginPagePatterns = z
  .strictObject({
    version: Text,
    as_of: DateSchema,
    url_patterns: z.array(Text.transform((pattern) => new RegExp(pattern, "iu"))).min(1),
    sources: z.array(z.strictObject({ path: Text, quote: Text })).min(1),
  })
  .parse(loginPages).url_patterns;

/**
 * Login, sign-in and identity-provider pages never receive guided input: credentials stay with
 * the user. Unparseable or undecodable addresses count as login pages (fail closed).
 */
export function isPortalLoginPage(value: string | URL): boolean {
  try {
    const url = new URL(value);
    const location = decodeURIComponent(`${url.pathname}${url.search}${url.hash}`);
    return loginPagePatterns.some((pattern) => pattern.test(location));
  } catch {
    return true;
  }
}
