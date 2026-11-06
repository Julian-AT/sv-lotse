import { DirectoryError } from "./schema.ts";

type Value = string | number | boolean | null;
type Truth = boolean | null;
const comparisons = new Set(["==", "!=", ">=", "<=", ">", "<"]);
function booleanValue(value: Value): Truth {
  return typeof value === "boolean" ? value : null;
}

function compare(left: Value, operator: string, right: Value): Truth {
  if (left === null || right === null) return null;
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return null;
  if (operator === ">=") return left >= right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  return left < right;
}

/** Non-executable catalog expressions. Missing slots stay unknown under negation. */
export function evaluateOfficeCondition(
  expression: string,
  slots: Readonly<Record<string, unknown>>,
): Truth {
  const tokens: string[] = [];
  const pattern =
    /\s*(>=|<=|==|!=|>|<|\(|\)|-?\d+(?:\.\d+)?|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)/y;
  let offset = 0;
  while (offset < expression.trimEnd().length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(expression);
    if (!match?.[1]) throw new DirectoryError("OFFICE_CONTEXT_REQUIRED");
    tokens.push(match[1]);
    offset = pattern.lastIndex;
  }
  let index = 0;
  const consume = (token: string): boolean => tokens[index] === token && ++index > 0;
  function operand(): Value {
    const token = tokens[index++];
    if (!token) throw new DirectoryError("OFFICE_CONTEXT_REQUIRED");
    if (token.startsWith('"')) return JSON.parse(token) as string;
    if (token.startsWith("'"))
      return token.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    if (token === "true" || token === "false") return token === "true";
    if (/^-?\d/.test(token)) return Number(token);
    const value = slots[token];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? value
      : null;
  }
  function unary(): Truth {
    if (consume("not")) {
      const value = unary();
      return value === null ? null : !value;
    }
    if (consume("(")) {
      const value = disjunction();
      if (!consume(")")) throw new DirectoryError("OFFICE_CONTEXT_REQUIRED");
      return value;
    }
    const left = operand();
    const operator = tokens[index];
    if (!operator || !comparisons.has(operator)) return booleanValue(left);
    index++;
    return compare(left, operator, operand());
  }
  function conjunction(): Truth {
    let left = unary();
    while (consume("and")) {
      const right = unary();
      left =
        left === false || right === false ? false : left === null || right === null ? null : true;
    }
    return left;
  }
  function disjunction(): Truth {
    let left = conjunction();
    while (consume("or")) {
      const right = conjunction();
      left =
        left === true || right === true ? true : left === null || right === null ? null : false;
    }
    return left;
  }
  const result = disjunction();
  if (index !== tokens.length) throw new DirectoryError("OFFICE_CONTEXT_REQUIRED");
  return result;
}

export function selectOfficeReference(
  rules: readonly { when: string; office: string }[],
  slots: Readonly<Record<string, unknown>>,
): string {
  const decisions = rules.map((rule) => ({
    ...rule,
    result: evaluateOfficeCondition(rule.when, slots),
  }));
  const matches = [
    ...new Set(decisions.filter((rule) => rule.result === true).map((rule) => rule.office)),
  ];
  const selected = matches[0];
  if (
    !selected ||
    matches.length !== 1 ||
    decisions.some((rule) => rule.result === null && rule.office !== selected)
  ) {
    throw new DirectoryError("OFFICE_CONTEXT_REQUIRED");
  }
  return selected;
}
