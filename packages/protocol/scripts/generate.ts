import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as protocol from "../src/index.ts";
import { projectSwiftSchema, restoreSwiftUnions } from "./swift.ts";
import { generateSwiftValidation } from "./swift-validation.ts";
import {
  generateSwiftValidationFixture,
  swiftValidationFixtureDirectory,
} from "./swift-validation-fixture.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const generatedPaths = [
  "generated/json",
  "swift/Sources/LotseProtocol",
  swiftValidationFixtureDirectory,
] as const;

export function stableJson(value: unknown): string {
  return `${JSON.stringify(
    value,
    (_key, item: unknown) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
      return Object.fromEntries(
        Object.entries(item).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
      );
    },
    2,
  )}\n`;
}

export async function generate(outputRoot: string): Promise<void> {
  const schemas = {
    ...protocol.MESSAGE_SCHEMAS,
    Target: protocol.TargetSchema,
    BridgeToWorkspace: protocol.BridgeToWorkspaceSchema,
    BridgeToNative: protocol.BridgeToNativeSchema,
    BoundingBox: protocol.BoundingBoxSchema,
    WindowRect: protocol.WindowRectSchema,
    Capabilities: protocol.CapabilitiesSchema,
    FactSource: protocol.FactSourceSchema,
    Provenance: protocol.ProvenanceSchema,
    JsonValue: protocol.JsonValueSchema,
    IsoTimestamp: protocol.IsoTimestampSchema,
    LanguageTag: protocol.LanguageTagSchema,
    Id: protocol.IdSchema,
  };
  const jsonRoot = join(outputRoot, "generated/json");
  const swiftPath = join(outputRoot, "swift/Sources/LotseProtocol/LotseProtocol.swift");
  await mkdir(jsonRoot, { recursive: true });
  await mkdir(dirname(swiftPath), { recursive: true });
  for (const [name, schema] of Object.entries(schemas)) {
    await writeFile(join(jsonRoot, `${name}.schema.json`), stableJson(z.toJSONSchema(schema)));
  }

  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of Object.entries(schemas)) registry.add(schema, { id: name });
  const definitions = z.toJSONSchema(registry, { uri: (id) => `#/$defs/${id}` }).schemas;
  for (const [name, definition] of Object.entries(definitions)) {
    definition.title = name;
    delete definition.$id;
    delete definition.$schema;
  }
  const bundle: z.core.JSONSchema.JSONSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: definitions,
    // Named entry points also expose every stream-only message to quicktype.
    type: "object",
    properties: Object.fromEntries(
      Object.keys(schemas).map((name) => [name, { $ref: `#/$defs/${name}` }]),
    ),
    required: Object.keys(schemas).sort(),
    additionalProperties: false,
  };
  const bundlePath = join(jsonRoot, "protocol.schema.json");
  await writeFile(bundlePath, stableJson(bundle));
  const { schema: swiftSchema, unions } = projectSwiftSchema(bundle);
  const temporary = await mkdtemp(join(tmpdir(), "lotse-quicktype-"));
  try {
    const inputPath = join(temporary, "protocol.schema.json");
    await writeFile(inputPath, stableJson(swiftSchema));
    const require = createRequire(import.meta.url);
    const result = spawnSync(
      "node",
      [
        require.resolve("quicktype"),
        "--src-lang",
        "schema",
        "--lang",
        "swift",
        "--src",
        inputPath,
        "--top-level",
        "LotseProtocolBundle",
        "--out",
        swiftPath,
        "--struct-or-class",
        "struct",
        "--access-level",
        "public",
        "--protocol",
        "equatable",
        "--sendable",
        "--no-initializers",
        "--no-combine-classes",
        "--no-date-times",
        "--no-uuids",
        "--alphabetize-properties",
      ],
      { encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`quicktype failed: ${result.stderr}`);
    const validated = generateSwiftValidation(
      await readFile(swiftPath, "utf8"),
      swiftSchema,
      unions,
    );
    await writeFile(swiftPath, restoreSwiftUnions(validated, unions));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const fixtureDirectory = join(outputRoot, swiftValidationFixtureDirectory);
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(
    join(fixtureDirectory, "ValidationFixture.swift"),
    generateSwiftValidationFixture(),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generate(process.argv[2] ? resolve(process.argv[2]) : packageRoot);
}
