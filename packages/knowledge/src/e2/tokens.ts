import { load } from "cheerio";
import * as ts from "typescript-compiler";
import { swiftTokens } from "./swift.ts";

export interface Token {
  value: string;
  offset: number;
}

function decodeJsxReferences(text: string): string {
  // Decode each reference once, without treating attribute/text content as HTML.
  return text.replace(/&(?:#\d+|#x[\da-fA-F]+|\w+);/g, (reference) =>
    load(reference, null, false).text(),
  );
}

// Parsing supplies the context needed to distinguish division, regexps and JSX.
// Only identifiers and literal content count; comments and regexp bodies do not.
export function codeTokens(source: string, swift = false, fileName = "source.tsx"): Token[] {
  if (swift) return swiftTokens(source);
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const tokens: Token[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isIdentifier(node) ||
      ts.isPrivateIdentifier(node) ||
      ts.isStringLiteralLike(node) ||
      ts.isTemplateLiteralToken(node) ||
      ts.isJsxText(node)
    ) {
      const jsx =
        ts.isJsxText(node) || (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent));
      tokens.push({
        value: jsx ? decodeJsxReferences(node.text) : node.text,
        offset: node.getStart(file),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return tokens;
}
