import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript/unstable/ast";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";
import { describe, expect, it } from "vitest";
import { de, en } from "../src/index";

const technicalLiterals = new Set([
  "",
  " ",
  ": ",
  "%",
  ")",
  "use client",
  "_blank",
  "noopener noreferrer",
  ":",
  "primary",
  "glass",
  "solid",
  "secondary",
  "ghost",
  "danger",
  "button",
  "info",
  "success",
  "warning",
  "error",
  "medium",
  "muted",
  "confirmed",
  "draft",
  "user",
  "assistant",
  "pilot",
  "office",
  "completed",
  "current",
  "step",
  "alert",
  "status",
  "dialog",
  "tab",
  "tablist",
  "tabpanel",
  "tooltip",
  "group",
  "checkbox",
  "radio",
  "true",
  "false",
  "polite",
  "additions text",
  "off",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "none",
  "hidden",
  "inert",
  "aria-hidden",
  "keydown",
  "focusin",
  "Escape",
  "Tab",
  "Home",
  "End",
  "ArrowRight",
  "ArrowLeft",
  "undefined",
  "small",
  "large",
  "xlarge",
  "type",
  "children",
  "pending",
  "prepared",
  "have",
  "missing",
  "obtainable",
  "h",
  "tel:",
  "[inert]",
  ":disabled, [hidden], [inert], [aria-hidden='true']",
]);
function hasAncestor(node: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (predicate(current)) return true;
    current = current.parent;
  }
  return false;
}

/** The installed TypeScript 7 public API provides syntax trees through a compiler session. */
function userLiterals(code: string): string[] {
  const file = resolve("test/copy-virtual/component.tsx");
  const config = resolve("test/copy-virtual/tsconfig.json");
  const api = new API({
    fs: createVirtualFileSystem({
      [file]: code,
      [config]: JSON.stringify({
        compilerOptions: { noLib: true, noResolve: true, types: [], jsx: "react-jsx" },
        files: ["component.tsx"],
      }),
    }),
  });
  try {
    using snapshot = api.updateSnapshot({ openProjects: [config] });
    const source = snapshot.getProject(config)?.program.getSourceFile(file);
    if (!source) throw new Error("COPY_SOURCE_UNAVAILABLE");
    const violations: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxText(node) && node.text.trim()) violations.push(node.text.trim());
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        const value = node.text.trim();
        const excluded = hasAncestor(
          node,
          (ancestor) =>
            ts.isTypeNode(ancestor) ||
            ts.isImportDeclaration(ancestor) ||
            ts.isExportDeclaration(ancestor),
        );
        const formatting = hasAncestor(
          node,
          (ancestor) =>
            ts.isJsxAttribute(ancestor) &&
            ["className", "id", "style"].includes(ancestor.name.getText(source)),
        );
        const accessibleText = hasAncestor(
          node,
          (ancestor) =>
            ts.isJsxAttribute(ancestor) &&
            ["aria-label", "title", "alt", "placeholder", "label", "summary", "content"].includes(
              ancestor.name.getText(source),
            ),
        );
        if (
          !excluded &&
          !formatting &&
          ((accessibleText && /[\p{L}\p{N}]/u.test(value)) ||
            (!technicalLiterals.has(value) &&
              !/^lotse-|^var\(--lotse-|^-(title|description|hint|error|keyboard|voice|tab-|panel-)$|^aria-/.test(
                value,
              )))
        )
          violations.push(value);
      }
      node.forEachChild(visit);
    };
    visit(source);
    return violations;
  } finally {
    api.close();
  }
}

describe("AC4: user-facing copy lives only in src/copy", () => {
  for (const file of readdirSync(resolve("src/components"))) {
    it(file, () => {
      expect(userLiterals(readFileSync(resolve("src/components", file), "utf8"))).toEqual([]);
    });
  }
  it("detects JSX text, accessibility attributes, variables, templates and fallback text", () => {
    for (const code of [
      "<button>Weiter</button>",
      '<button aria-label="Schließen" />',
      '<button aria-label="info" />',
      'const message = "Bitte prüfen";',
      "const message = `Hallo $" + "{name}`;",
      '<div>{label ?? "Quelle"}</div>',
      '<input placeholder="Name" />',
    ])
      expect(userLiterals(code).length).toBeGreaterThan(0);
  });
  it("German and English have the same complete, non-empty label keys", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    expect(Object.values(de).every((value) => value.trim().length > 0)).toBe(true);
    expect(Object.values(en).every((value) => value.trim().length > 0)).toBe(true);
  });
});
