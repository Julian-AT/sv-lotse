export interface Token {
  value: string;
  offset: number;
}

// A lexical scan suffices: ids must never occur in literals or identifiers,
// regardless of whether the containing branch is reachable. Comments are ignored.
export function codeTokens(source: string, swift = false): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  let canEndExpression = false;
  const emit = (value: string, offset: number) => {
    tokens.push({ value, offset });
  };
  function escaped(rawHashes: string): string {
    position += 1 + rawHashes.length;
    const char = source[position++] ?? "";
    if (char === "u") {
      const tail = source.slice(position);
      const match =
        /^\{([\da-fA-F]+)\}/.exec(tail) ?? (!swift ? /^([\da-fA-F]{4})/.exec(tail) : null);
      if (match?.[1]) {
        position += match[0].length;
        const code = Number.parseInt(match[1], 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
    }
    if (char === "x" && !swift) {
      const digits = source.slice(position, position + 2);
      if (/^[\da-fA-F]{2}$/.test(digits)) {
        position += 2;
        return String.fromCharCode(Number.parseInt(digits, 16));
      }
    }
    if (char === "\n") return "";
    if (char === "\r") {
      if (source[position] === "\n") position++;
      return "";
    }
    return (
      (
        { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<
          string,
          string
        >
      )[char] ?? char
    );
  }
  function quoted(delimiter: string, hashes = ""): void {
    const start = position;
    position += hashes.length + delimiter.length;
    let segment = "";
    let segmentStart = start;
    while (position < source.length) {
      if (source.startsWith(delimiter + hashes, position)) {
        emit(segment, segmentStart);
        position += delimiter.length + hashes.length;
        return;
      }
      const template = delimiter === "`" && source.startsWith("${", position);
      const interpolation = swift && source.startsWith(`\\${hashes}(`, position);
      if (template || interpolation) {
        emit(segment, segmentStart);
        segment = "";
        position += template ? 2 : 2 + hashes.length;
        code(template ? "}" : ")");
        segmentStart = position;
      } else if (source.startsWith(`\\${hashes}`, position)) segment += escaped(hashes);
      else segment += source[position++];
    }
    emit(segment, segmentStart);
  }
  function code(end?: string): void {
    while (position < source.length) {
      const char = source[position] ?? "";
      if (end === char) {
        position++;
        return;
      }
      if (/\s/.test(char)) {
        position++;
        continue;
      }
      if (source.startsWith("//", position)) {
        const newline = source.indexOf("\n", position);
        position = newline < 0 ? source.length : newline;
        continue;
      }
      if (source.startsWith("/*", position)) {
        position += 2;
        let depth = 1;
        while (position < source.length && depth > 0) {
          if (swift && source.startsWith("/*", position)) {
            depth++;
            position += 2;
          } else if (source.startsWith("*/", position)) {
            depth--;
            position += 2;
          } else position++;
        }
        continue;
      }
      const raw = swift ? /^(#+)("""|")/.exec(source.slice(position)) : null;
      if (raw?.[1] && raw[2]) {
        quoted(raw[2], raw[1]);
        canEndExpression = true;
        continue;
      }
      if (char === '"' || (!swift && (char === "'" || char === "`"))) {
        quoted(swift && source.startsWith('"""', position) ? '"""' : char);
        canEndExpression = true;
        continue;
      }
      if (!swift && source.startsWith("</", position)) {
        // A JSX closing tag is not the start of a regular expression.
        position += 2;
        canEndExpression = false;
        continue;
      }
      if (!swift && char === "/" && !canEndExpression) {
        // JavaScript regexp bodies are neither identifiers nor string literals.
        position++;
        let characterClass = false;
        while (position < source.length) {
          const current = source[position++];
          if (current === "\\") position++;
          else if (current === "[") characterClass = true;
          else if (current === "]") characterClass = false;
          else if (current === "/" && !characterClass) break;
          else if (current === "\n") break;
        }
        while (/[a-z]/i.test(source[position] ?? "")) position++;
        canEndExpression = true;
        continue;
      }
      if (/[\p{L}_$]/u.test(char) || (!swift && source.startsWith("\\u", position))) {
        const start = position;
        let value = "";
        while (position < source.length) {
          if (!swift && source.startsWith("\\u", position)) value += escaped("");
          else if (/[\p{L}\p{N}_$]/u.test(source[position] ?? "")) value += source[position++];
          else break;
        }
        emit(value, start);
        canEndExpression = ![
          "return",
          "throw",
          "case",
          "typeof",
          "void",
          "delete",
          "new",
          "in",
          "of",
          "yield",
          "await",
        ].includes(value);
        continue;
      }
      const closing = ({ "(": ")", "[": "]", "{": "}" } as Record<string, string>)[char];
      position++;
      if (closing) {
        canEndExpression = false;
        code(closing);
        canEndExpression = true;
      } else canEndExpression = /[\d)\]]/.test(char);
    }
  }
  code();
  return tokens;
}
