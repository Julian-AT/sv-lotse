// Attach schema-derived validation to quicktype's actual Swift names, including
// anonymous nested objects. The projected unions are restored after this pass.
import type { z } from "zod";
import { fields, type Union } from "./swift.ts";

type Schema = z.core.JSONSchema.JSONSchema;

const literal = (value: string) => JSON.stringify(value).replace(/\\u([0-9a-f]{4})/gi, "\\u{$1}");

function foundationPattern(pattern: string): string {
  // ECMAScript's \d is ASCII; ICU's is Unicode. Its non-multiline $ is
  // absolute end of input; ICU also accepts a trailing newline by default.
  // Walk escapes/classes so a literal dollar or backslash keeps its meaning.
  let result = "";
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\" && index + 1 < pattern.length) {
      const escaped = pattern[++index];
      result += escaped === "d" ? (inClass ? "0-9" : "[0-9]") : `\\${escaped}`;
    } else {
      if (character === "[") inClass = true;
      if (character === "]") inClass = false;
      result += character === "$" && !inClass ? "\\z" : character;
    }
  }
  return result;
}

// The full RFC 3986 grammar used by UriSchema (not Foundation.URL, which can
// normalize/percent-encode invalid input). Keep parity covered by shared tests.
function uriPattern(): string {
  const character = "(?:[a-z0-9._~!$&'()*+,;=\\-]|%[0-9a-f]{2})";
  const path = "(?:[a-z0-9._~!$&'()*+,;=:@\\-]|%[0-9a-f]{2})";
  const query = "(?:[a-z0-9._~!$&'()*+,;=:@/?\\-]|%[0-9a-f]{2})";
  const octet = "(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)";
  const ipv4 = `(?:${octet}\\.){3}${octet}`;
  const h16 = "[0-9a-f]{1,4}";
  const ls32 = `(?:${h16}:${h16}|${ipv4})`;
  const ipv6 = [
    `(?:${h16}:){6}${ls32}`,
    `::(?:${h16}:){5}${ls32}`,
    `(?:${h16})?::(?:${h16}:){4}${ls32}`,
    ...[1, 2, 3, 4].map(
      (count) => `(?:(?:${h16}:){0,${count}}${h16})?::(?:${h16}:){${4 - count}}${ls32}`,
    ),
    `(?:(?:${h16}:){0,5}${h16})?::${h16}`,
    `(?:(?:${h16}:){0,6}${h16})?::`,
  ].join("|");
  const ipLiteral = `\\[(?:${ipv6}|v[0-9a-f]+\\.[a-z0-9._~!$&'()*+,;=:\\-]+)\\]`;
  const authority = `\\/?\\/(?:(?:${character}|:)*@)?(?:${ipLiteral}|${ipv4}|${character}*)(?::[0-9]*)?`;
  const suffix = `(?:/${path}*)*`;
  const nonempty = `${path}+${suffix}`;
  const hierarchy = `(?:${authority}${suffix}|/(?:${nonempty})?|${nonempty})`;
  return `^[a-z][a-z0-9+.\\-]*:${hierarchy}(?:\\?${query}*)?(?:#${query}*)?$`;
}

export function generateSwiftValidation(source: string, bundle: Schema, unions: Union[]): string {
  const structs = new Map(
    Array.from(
      source.matchAll(/^public struct (\w+): Codable, Equatable, Sendable \{\n([\s\S]*?)^\}/gm),
      (match) => [String(match[1]), fields(String(match[2]))],
    ),
  );
  const schemas = new Map<string, Schema>();
  const unionByName = new Map(unions.map((union) => [union.name, union]));
  function resolve(node: Schema): Schema {
    if (!node.$ref) return node;
    const definition = bundle.$defs?.[node.$ref.replace(/^#\/\$defs\//, "")];
    if (typeof definition !== "object") throw new Error(`Unresolved schema: ${node.$ref}`);
    return resolve(definition);
  }
  function visit(type: string, input: Schema): void {
    const node = resolve(input);
    if (type.endsWith("?")) {
      visit(type.slice(0, -1), node);
      return;
    }
    if (node.type === "array" && typeof node.items === "object" && !Array.isArray(node.items)) {
      if (!type.startsWith("[") || !type.endsWith("]"))
        throw new Error(`Expected Swift array, got ${type}`);
      visit(type.slice(1, -1), node.items);
      return;
    }
    const members = structs.get(type);
    if (!members || schemas.has(type)) return;
    if (node.type !== "object") throw new Error(`Expected object schema for ${type}`);
    const wireKeys = new Set(members.map((member) => member.wire));
    if (Object.keys(node.properties ?? {}).some((key) => !wireKeys.has(key)))
      throw new Error(`quicktype omitted properties of ${type}`);
    schemas.set(type, node);
    for (const member of members) {
      const property = node.properties?.[member.wire];
      if (typeof property !== "object") throw new Error(`Missing schema: ${type}.${member.wire}`);
      visit(member.type, property);
    }
  }
  visit("LotseProtocolBundle", bundle);
  for (const name of structs.keys()) {
    if (!schemas.has(name)) throw new Error(`Unmapped quicktype object: ${name}`);
  }

  const patterns = new Map<string, string>();
  function pattern(value: string, insensitive = false): string {
    const translated = foundationPattern(value);
    const initializer = `try NSRegularExpression(pattern: ${literal(translated)}, options: ${insensitive ? ".caseInsensitive" : "[]"})`;
    let name = patterns.get(initializer);
    if (!name) {
      name = `pattern${patterns.size}`;
      patterns.set(initializer, name);
    }
    return `try ProtocolPatterns.${name}.get()`;
  }
  function checks(input: Schema, type: string, value: string, path: string): string[] {
    const node = resolve(input);
    if (type.endsWith("?")) {
      const nested = checks(node, type.slice(0, -1), "value", path);
      return nested.length
        ? [`if let value = ${value} {`, ...nested.map((line) => `    ${line}`), `}`]
        : [];
    }
    const lines: string[] = [];
    const guard = (condition: string, keyword: string) => {
      lines.push(
        `guard ${condition} else {`,
        `    throw ProtocolValidationError(path: ${path}, keyword: ${literal(keyword)})`,
        `}`,
      );
    };
    if (type === "JSONValue" || schemas.has(type)) {
      return [`try ${value}.validate(at: ${path})`];
    }
    if (node.type === "array" && typeof node.items === "object" && !Array.isArray(node.items)) {
      const nested = checks(node.items, type.slice(1, -1), "item", `${path} + [String(index)]`);
      if (nested.length)
        lines.push(
          `for (index, item) in ${value}.enumerated() {`,
          ...nested.map((line) => `    ${line}`),
          `}`,
        );
    } else if (node.type === "object" && typeof node.additionalProperties === "object") {
      if (type !== "[String: JSONValue]") throw new Error(`Unsupported dictionary: ${type}`);
      lines.push(
        `for (key, item) in ${value} {`,
        `    try item.validate(at: ${path} + [key])`,
        `}`,
      );
    } else if (node.type === "string") {
      const string = type === "String" ? value : `${value}.rawValue`;
      // Zod measures JS string.length (UTF-16 code units), not Swift graphemes.
      if (node.minLength !== undefined)
        guard(`${string}.utf16.count >= ${node.minLength}`, "minLength");
      if (node.maxLength !== undefined)
        guard(`${string}.utf16.count <= ${node.maxLength}`, "maxLength");
      if (node.pattern)
        guard(
          `(${pattern(node.pattern)}).firstMatch(in: ${string}, range: NSRange(location: 0, length: ${string}.utf16.count)) != nil`,
          "pattern",
        );
      if (node.format === "uri") {
        guard(`${string}.unicodeScalars.allSatisfy({ $0.isASCII })`, "format");
        guard(
          `(${pattern(uriPattern(), true)}).firstMatch(in: ${string}, range: NSRange(location: 0, length: ${string}.utf16.count)) != nil`,
          "format",
        );
      } else if (node.format && !(node.format === "date-time" && node.pattern)) {
        throw new Error(`Unsupported Swift string format: ${node.format}`);
      }
    } else if (node.type === "number" || node.type === "integer") {
      if (type === "Double") {
        guard(`${value}.isFinite`, "type");
        if (node.type === "integer") guard(`${value}.rounded(.towardZero) == ${value}`, "type");
      } else if (type !== "Int") throw new Error(`Unsupported Swift number: ${type}`);
      for (const [keyword, operator] of [
        ["minimum", ">="],
        ["maximum", "<="],
        ["exclusiveMinimum", ">"],
        ["exclusiveMaximum", "<"],
      ] as const) {
        if (node[keyword] !== undefined) guard(`${value} ${operator} ${node[keyword]}`, keyword);
      }
    } else if (node.type !== "boolean") {
      throw new Error(`Unsupported validation schema for ${type}`);
    }
    if (node.const !== undefined) {
      const constant =
        typeof node.const === "string" ? literal(node.const) : JSON.stringify(node.const);
      const actual = node.type === "string" && type !== "String" ? `${value}.rawValue` : value;
      guard(`${actual} == ${constant}`, "const");
    }
    return lines;
  }

  const extensions: string[] = [];
  for (const [name, node] of schemas) {
    const members = structs.get(name);
    if (!members) throw new Error(`Missing quicktype object: ${name}`);
    const union = unionByName.get(name);
    const body = union
      ? [
          `switch self {`,
          ...members.map(
            (member) => `case .${member.name}(let value): try value.validate(at: path)`,
          ),
          `}`,
        ]
      : members.flatMap((member) => {
          const property = node.properties?.[member.wire];
          if (typeof property !== "object")
            throw new Error(`Missing property: ${name}.${member.wire}`);
          return checks(
            property,
            member.type,
            `self.${member.name}`,
            `path + [${literal(member.wire)}]`,
          );
        });
    extensions.push(
      [
        `extension ${name}: ProtocolValidating {`,
        `    public func validate(at path: [String]) throws {`,
        ...body.map((line) => `        ${line}`),
        `    }`,
        `}`,
      ].join("\n"),
    );
  }
  const documentedSource = source.replace(
    "let lotseProtocolBundle = try? JSONDecoder().decode(LotseProtocolBundle.self, from: jsonData)",
    "let lotseProtocolBundle: LotseProtocolBundle = try decodeValidated(jsonData)",
  );
  return `${documentedSource}\n${runtime}\n${extensions.join("\n\n")}\n\nprivate enum ProtocolPatterns {\n${[...patterns].map(([initializer, name]) => `    static let ${name} = Result { ${initializer} }`).join("\n")}\n}\n`;
}

const runtime = `// Schema validation is separate from Codable so locally constructed values can
// be checked as well. Error paths use wire keys and never include field values.
public protocol ProtocolValidating: Codable {
    func validate(at path: [String]) throws
}

public extension ProtocolValidating {
    func validate() throws { try validate(at: []) }
}

public struct ProtocolValidationError: Error, Equatable, Sendable {
    public let path: [String]
    public let keyword: String

    public init(path: [String], keyword: String) {
        self.path = path
        self.keyword = keyword
    }
}

/// Decode strict wire JSON, then enforce the schema's recursive constraints.
public func decodeValidated<Value: ProtocolValidating>(_ data: Data) throws -> Value {
    let value = try JSONDecoder().decode(Value.self, from: data)
    try value.validate()
    return value
}

extension JSONValue: ProtocolValidating {
    public func validate(at path: [String]) throws {
        switch self {
        case .double(let value):
            guard value.isFinite else {
                throw ProtocolValidationError(path: path, keyword: "type")
            }
        case .unionArray(let values):
            for (index, value) in values.enumerated() {
                try value.validate(at: path + [String(index)])
            }
        case .unionMap(let values):
            for (key, value) in values {
                try value.validate(at: path + [key])
            }
        case .bool, .string, .null: break
        }
    }
}
`;
