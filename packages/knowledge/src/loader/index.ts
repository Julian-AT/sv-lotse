import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import type { z } from "zod";
import {
  AllowlistSchema,
  BenefitSchema,
  FacilitySchema,
  FormSchema,
  OfficeSchema,
  ProcessSchema,
  referencePattern,
  SourceRegistrySchema,
} from "../schemas/index.ts";
import { isMissing, sourceFiles } from "./files.ts";

export const knowledgeRoot = fileURLToPath(new URL("../../", import.meta.url));
const schemas = {
  catalog: BenefitSchema,
  processes: ProcessSchema,
  offices: OfficeSchema,
  facilities: FacilitySchema,
  forms: FormSchema,
};
type Kind = keyof typeof schemas;
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
type Collections = { [K in Kind]: Record<string, z.infer<(typeof schemas)[K]>> };
export type Knowledge = DeepReadonly<
  Collections & {
    allowlist?: z.infer<typeof AllowlistSchema>;
    sources?: z.infer<typeof SourceRegistrySchema>;
    resolve: (reference: string) => unknown;
  }
>;

export class KnowledgeError extends Error {
  constructor(
    readonly file: string,
    readonly path: string,
    detail: string,
  ) {
    super(`${file}: ${path || "$"}: ${detail}`);
    this.name = "KnowledgeError";
  }
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
async function readRecord(file: string): Promise<unknown> {
  const text = await readFile(file, "utf8");
  if (file.endsWith(".json")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new KnowledgeError(file, "$", "Invalid JSON");
    }
  }
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length || document.warnings.length)
    throw new KnowledgeError(file, "$", "Invalid YAML (check syntax, tags and duplicate keys)");
  try {
    return document.toJS({ maxAliasCount: 100 });
  } catch {
    throw new KnowledgeError(file, "$", "Invalid YAML aliases");
  }
}
function validate<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.map(String) ?? [];
  if (issue?.code === "unrecognized_keys") path.push(...issue.keys);
  // Avoid echoing record contents in diagnostics.
  throw new KnowledgeError(file, path.join("."), issue?.code ?? "Invalid record");
}
function visitReferences(
  value: unknown,
  visit: (reference: string, path: string) => void,
  path = "",
): void {
  if (typeof value === "string" && value.startsWith("ref:")) visit(value, path);
  else if (value !== null && typeof value === "object")
    for (const [key, child] of Object.entries(value))
      visitReferences(child, visit, path ? `${path}.${key}` : key);
}
export async function loadKnowledge(root = knowledgeRoot): Promise<Knowledge> {
  try {
    if (!(await stat(root)).isDirectory()) throw new Error("Not a directory");
  } catch {
    throw new KnowledgeError(root, "$", "Knowledge root must be an existing directory");
  }
  const collections: Collections = {
    catalog: {},
    processes: {},
    offices: {},
    facilities: {},
    forms: {},
  };
  const files = new Map<string, string>();
  // All records are registered before links are checked; catalog/process cycles are valid.
  for (const kind of Object.keys(schemas) as Kind[]) {
    for (const file of await sourceFiles(join(root, kind), new Set([".yaml", ".yml", ".json"]))) {
      const record = validate(
        schemas[kind] as z.ZodType<{ id: string }>,
        await readRecord(file),
        file,
      );
      const key = `${kind}/${record.id}`;
      const previous = files.get(key);
      if (previous)
        throw new KnowledgeError(file, "id", `Duplicate id; first declared in ${previous}`);
      files.set(key, file);
      // Each kind has been validated by the matching schema above.
      Object.defineProperty(collections[kind], record.id, { value: record, enumerable: true });
    }
  }
  function resolve(reference: string): unknown {
    const match = referencePattern.exec(reference);
    if (!match?.[1] || !match[2]) throw new Error("Invalid reference syntax");
    const kind = match[1] as Kind;
    if (!Object.hasOwn(collections[kind], match[2])) throw new Error("Dangling reference");
    let target: unknown = collections[kind][match[2]];
    for (const part of match[3]?.split(".") ?? []) {
      if (target === null || typeof target !== "object" || !Object.hasOwn(target, part))
        throw new Error("Dangling reference fragment");
      target = Reflect.get(target, part);
    }
    return target;
  }
  for (const kind of Object.keys(schemas) as Kind[])
    for (const record of Object.values(collections[kind])) {
      visitReferences(record, (reference, path) => {
        try {
          resolve(reference);
        } catch {
          throw new KnowledgeError(
            files.get(`${kind}/${record.id}`) ?? root,
            path,
            "Dangling or invalid reference",
          );
        }
      });
    }
  const registries: {
    allowlist?: z.infer<typeof AllowlistSchema>;
    sources?: z.infer<typeof SourceRegistrySchema>;
  } = {};
  for (const [name, schema] of [
    ["allowlist", AllowlistSchema],
    ["sources", SourceRegistrySchema],
  ] as const) {
    const file = join(root, `${name}.yaml`);
    let raw: unknown;
    try {
      raw = await readRecord(file);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    Object.defineProperty(registries, name, {
      value: validate(schema as z.ZodType, raw, file),
      enumerable: true,
    });
  }
  const allowedOrigins = new Set(registries.allowlist?.origins.map((entry) => entry.origin));
  for (const benefit of Object.values(collections.catalog)) {
    for (const [index, channel] of benefit.appointment_channels.entries()) {
      if (channel.kind === "online" && !allowedOrigins.has(new URL(channel.url).origin))
        throw new KnowledgeError(
          files.get(`catalog/${benefit.id}`) ?? root,
          `appointment_channels.${index}.url`,
          "Online booking origin must be in allowlist.yaml",
        );
    }
  }
  return freeze({ ...collections, ...registries, resolve });
}
