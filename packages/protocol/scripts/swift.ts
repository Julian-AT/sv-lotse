// quicktype merges object alternatives. Project only those alternatives to named
// branches, then restore their wire representation with schema-directed codecs.
// All properties, branch structs and scalar enums remain quicktype-generated.
import type { z } from "zod";

type Schema = z.core.JSONSchema.JSONSchema;
type Variant = { tag: string; property: string };
export type Union = { name: string; discriminator: string | undefined; variants: Variant[] };

const pascal = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
const camel = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

export function projectSwiftSchema(bundle: Schema): { schema: Schema; unions: Union[] } {
  const schema = structuredClone(bundle);
  const unions: Union[] = [];
  function visit(node: Schema, name: string): void {
    if (node.$ref) return;
    const alternatives = node.anyOf ?? node.oneOf;
    if (alternatives) {
      const discriminator = ["kind", "type"].find((key) =>
        alternatives.every(
          (branch) =>
            typeof branch === "object" &&
            typeof branch.properties?.[key] === "object" &&
            typeof branch.properties[key].const === "string",
        ),
      );
      const objectReferences = alternatives.every((branch) => {
        if (typeof branch !== "object" || !branch.$ref?.startsWith("#/$defs/")) return false;
        const referenced = schema.$defs?.[branch.$ref.slice("#/$defs/".length)];
        return typeof referenced === "object" && referenced.type === "object";
      });
      if (discriminator || objectReferences) {
        const variants: Variant[] = [];
        const properties: Record<string, Schema> = {};
        for (const branch of alternatives) {
          if (typeof branch !== "object") throw new Error(`Unsupported union ${name}`);
          const tagSchema = discriminator ? branch.properties?.[discriminator] : undefined;
          const tag =
            typeof tagSchema === "object"
              ? String(tagSchema.const)
              : branch.$ref?.slice("#/$defs/".length);
          if (!tag) throw new Error(`Missing tag for ${name}`);
          const property = camel(tag);
          const branchName = `${name}${pascal(tag)}`;
          properties[property] = { ...branch, ...(branch.$ref ? {} : { title: branchName }) };
          visit(properties[property], branchName);
          variants.push({ tag, property });
        }
        delete node.anyOf;
        delete node.oneOf;
        Object.assign(node, {
          type: "object",
          title: name,
          properties,
          required: Object.keys(properties),
          additionalProperties: false,
        });
        unions.push({ name, discriminator, variants });
        return;
      }
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      if (typeof child === "object") visit(child, `${name}${pascal(key)}`);
    }
    if (typeof node.items === "object" && !Array.isArray(node.items))
      visit(node.items, `${name}Item`);
  }
  for (const [name, definition] of Object.entries(schema.$defs ?? {})) {
    if (typeof definition === "object") visit(definition, name);
  }
  return { schema, unions };
}

export function fields(body: string): { name: string; type: string; wire: string }[] {
  const keys = new Map(
    Array.from(body.matchAll(/^ {8}case (\w+) = "([^"]+)"$/gm), (match) => [match[1], match[2]]),
  );
  return Array.from(body.matchAll(/^ {4}public let (\w+): (.+)$/gm), (match) => {
    const [, name, type] = match;
    const wire = keys.get(name);
    if (!name || !type || !wire) throw new Error("Unsupported quicktype property output");
    return { name, type, wire };
  });
}

export function restoreSwiftUnions(source: string, unions: Union[]): string {
  const byName = new Map(unions.map((union) => [union.name, union]));
  const cleanSource = source.replace(
    /^\/\/\n\/\/ Hashable or Equatable:\n(?:\/\/[^\n]*\n)+\n/gm,
    "",
  );
  const restored = cleanSource.replace(
    /^public struct (\w+): Codable, Equatable, Sendable \{\n([\s\S]*?)^\}/gm,
    (whole: string, name: string, body: string) => {
      const union = byName.get(name);
      const members = fields(body);
      if (union) {
        byName.delete(name);
        const cases = union.variants.map((variant) => {
          const field = members.find((member) => member.wire === variant.property);
          if (!field) throw new Error(`quicktype omitted ${name}.${variant.property}`);
          return { ...variant, name: field.name, type: field.type };
        });
        const decode = union.discriminator
          ? [
              `        let container = try decoder.container(keyedBy: ProtocolCodingKey.self)`,
              `        let tag = try container.decode(String.self, forKey: ProtocolCodingKey("${union.discriminator}"))`,
              `        switch tag {`,
              ...cases.map(
                (item) =>
                  `        case "${item.tag}": self = .${item.name}(try ${item.type}(from: decoder))`,
              ),
              `        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ${name} tag"))`,
              `        }`,
            ]
          : [
              ...cases.flatMap((item) => [
                `        if let value = try? ${item.type}(from: decoder) {`,
                `            self = .${item.name}(value)`,
                `            return`,
                `        }`,
              ]),
              `        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid ${name}"))`,
            ];
        return [
          `public enum ${name}: Codable, Equatable, Sendable {`,
          ...cases.map((item) => `    case ${item.name}(${item.type})`),
          ``,
          `    public init(from decoder: Decoder) throws {`,
          ...decode,
          `    }`,
          ``,
          `    public func encode(to encoder: Encoder) throws {`,
          `        switch self {`,
          ...cases.map(
            (item) => `        case .${item.name}(let value): try value.encode(to: encoder)`,
          ),
          `        }`,
          `    }`,
          `}`,
        ].join("\n");
      }
      // Preserve strict objects and reject explicit null on optional properties.
      // Synthesized Codable would otherwise silently accept and discard both.
      const decoder = [
        `    public init(from decoder: Decoder) throws {`,
        `        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)`,
        `        let allowed: Set<String> = [${members.map((member) => `"${member.wire}"`).join(", ")}]`,
        `        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {`,
        `            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ${name} field"))`,
        `        }`,
        `        let container = try decoder.container(keyedBy: CodingKeys.self)`,
        ...members.flatMap((member) => {
          const optional = member.type.endsWith("?");
          const type = optional ? member.type.slice(0, -1) : member.type;
          return [
            ...(optional
              ? [
                  `        if container.contains(.${member.name}), try container.decodeNil(forKey: .${member.name}) {`,
                  `            throw DecodingError.valueNotFound(${type}.self, .init(codingPath: decoder.codingPath, debugDescription: "Null ${member.wire}"))`,
                  `        }`,
                ]
              : []),
            `        self.${member.name} = try container.${optional ? "decodeIfPresent" : "decode"}(${type}.self, forKey: .${member.name})`,
          ];
        }),
        `    }`,
      ].join("\n");
      return `${whole.slice(0, -1)}\n${decoder}\n}`;
    },
  );
  if (byName.size > 0)
    throw new Error(`quicktype omitted unions: ${[...byName.keys()].join(", ")}`);
  return `${restored}\n// Internal keys used by the generated strict-object and tagged-union decoders.\nprivate struct ProtocolCodingKey: CodingKey {\n    let stringValue: String\n    var intValue: Int? { nil }\n    init(_ value: String) { stringValue = value }\n    init?(stringValue: String) { self.stringValue = stringValue }\n    init?(intValue: Int) { return nil }\n}\n`;
}
