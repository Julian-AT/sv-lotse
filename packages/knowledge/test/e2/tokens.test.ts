import { expect, test } from "vitest";
import { codeTokens } from "../../src/e2/tokens.ts";

test("E2 reads JavaScript escaped literals, templates and interpolation identifiers", () => {
  const source = `const id = "fixture\\u002dbenefit"; const other = \`before \${fixture_situation} after\`;`;
  expect(codeTokens(source).map((token) => token.value)).toEqual(
    expect.arrayContaining(["fixture-benefit", "before ", "fixture_situation", " after"]),
  );
});
test("E2 ignores JavaScript comments and regular expressions", () => {
  const source =
    '// fixture-benefit\n/* fixture-office */\nconst expression = /fixture_form/; const id = "fixture-form";';
  for (const value of ["fixture-benefit", "fixture-office", "fixture_form"]) {
    expect(codeTokens(source).map((token) => token.value)).not.toContain(value);
  }
  expect(codeTokens(source).map((token) => token.value)).toContain("fixture-form");
});
test("E2 reads Swift raw and multiline strings, unicode and interpolation", () => {
  const source =
    '/* outer /* fixture-benefit */ inner */\nlet a = #"fixture-benefit"#\nlet b = """\nfixture-office\n"""\nlet c = "fixture\\u{002d}form"\nlet d = "prefix \\(fixture_situation)"';
  const values = codeTokens(source, true).map((token) => token.value);
  expect(values).toEqual(
    expect.arrayContaining([
      "fixture-benefit",
      "\nfixture-office\n",
      "fixture-form",
      "fixture_situation",
    ]),
  );
  expect(values.filter((value) => value === "fixture-benefit")).toHaveLength(1);
});

test("E2 scans literals after JSX closing tags", () => {
  const source = 'const view = <div></div>; const id = "fixture-benefit";';
  expect(codeTokens(source).map((token) => token.value)).toContain("fixture-benefit");
});
