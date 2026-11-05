import type { Token } from "./tokens.ts";

// Swift raw strings, interpolation and nested comments have separate lexical rules.
export function swiftTokens(source: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  const emit = (value: string, offset: number) => {
    tokens.push({ value, offset });
  };
  function escaped(rawHashes: string): string {
    position += 1 + rawHashes.length;
    const char = source[position++] ?? "";
    if (char === "u") {
      const tail = source.slice(position);
      const match = /^\{([\da-fA-F]+)\}/.exec(tail);
      if (match?.[1]) {
        position += match[0].length;
        const code = Number.parseInt(match[1], 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : "";
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
      const interpolation = source.startsWith(`\\${hashes}(`, position);
      if (interpolation) {
        emit(segment, segmentStart);
        segment = "";
        position += 2 + hashes.length;
        code(")");
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
          if (source.startsWith("/*", position)) {
            depth++;
            position += 2;
          } else if (source.startsWith("*/", position)) {
            depth--;
            position += 2;
          } else position++;
        }
        continue;
      }
      const raw = /^(#+)("""|")/.exec(source.slice(position));
      if (raw?.[1] && raw[2]) {
        quoted(raw[2], raw[1]);
        continue;
      }
      if (char === '"') {
        quoted(source.startsWith('"""', position) ? '"""' : char);
        continue;
      }
      if (/[\p{L}_$]/u.test(char)) {
        const start = position;
        let value = "";
        while (position < source.length) {
          if (/[\p{L}\p{N}_$]/u.test(source[position] ?? "")) value += source[position++];
          else break;
        }
        emit(value, start);
        continue;
      }
      const closing = ({ "(": ")", "[": "]", "{": "}" } as Record<string, string>)[char];
      position++;
      if (closing) code(closing);
    }
  }
  code();
  return tokens;
}
