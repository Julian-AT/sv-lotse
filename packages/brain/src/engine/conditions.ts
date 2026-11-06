import type { JsonValue } from "./schema.ts";

export type Truth = boolean | undefined;
type Operand = JsonValue | undefined;
const tokenPattern =
  /\s*(>=|<=|==|!=|>|<|\(|\)|-?\d+(?:\.\d+)?|"(?:[^"\\\n]|\\["\\/bfnrt]|\\u[\da-fA-F]{4})*"|'(?:[^'\\\n]|\\['\\nrt])*'|[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)/y;

function tokenize(expression: string): string[] | undefined {
  const result: string[] = [];
  let offset = 0;
  while (offset < expression.trimEnd().length) {
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(expression);
    if (!match?.[1]) return undefined;
    result.push(match[1]);
    offset = tokenPattern.lastIndex;
  }
  return result;
}

function lookup(key: string, values: Readonly<Record<string, JsonValue>>): Operand {
  if (Object.hasOwn(values, key)) return values[key];
  let current: Operand = values;
  for (const part of key.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = Object.hasOwn(current, part) ? current[part] : undefined;
  }
  return current;
}

function compare(left: Operand, operator: string, right: Operand): Truth {
  if (left === undefined || right === undefined || left === null || right === null)
    return undefined;
  if (typeof left !== typeof right) return undefined;
  if (operator === "==") return left === right;
  if (operator === "!=") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return undefined;
  if (operator === ">") return left > right;
  if (operator === "<") return left < right;
  if (operator === ">=") return left >= right;
  return left <= right;
}

/** Three-valued evaluation; missing data never becomes a negative eligibility claim. No eval. */
export function evaluateCondition(
  expression: string | undefined,
  values: Readonly<Record<string, JsonValue>>,
): Truth {
  if (!expression) return undefined;
  const tokens = tokenize(expression);
  if (!tokens) return undefined;
  let position = 0;
  let valid = true;
  function consume(token: string): boolean {
    if (tokens?.[position] !== token) return false;
    position++;
    return true;
  }
  function operand(): Operand {
    const token = tokens?.[position++];
    if (!token) {
      valid = false;
      return undefined;
    }
    if (token === "true" || token === "false") return token === "true";
    if (/^-?\d/.test(token)) return Number(token);
    if (token.startsWith('"')) return JSON.parse(token) as string;
    if (token.startsWith("'"))
      return token
        .slice(1, -1)
        .replace(
          /\\(['\\nrt])/g,
          (_, escaped: string) => ({ n: "\n", r: "\r", t: "\t" })[escaped] ?? escaped,
        );
    if (!/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(token)) valid = false;
    return lookup(token, values);
  }
  function unary(): Truth {
    if (consume("not")) {
      const result = unary();
      return result === undefined ? undefined : !result;
    }
    if (consume("(")) {
      const result = disjunction();
      if (!consume(")")) valid = false;
      return result;
    }
    const left = operand();
    const operator = tokens?.[position];
    if (operator && [">", "<", ">=", "<=", "==", "!="].includes(operator)) {
      position++;
      return compare(left, operator, operand());
    }
    return typeof left === "boolean" ? left : undefined;
  }
  function conjunction(): Truth {
    let left = unary();
    while (consume("and")) {
      const right = unary();
      left =
        left === false || right === false
          ? false
          : left === undefined || right === undefined
            ? undefined
            : true;
    }
    return left;
  }
  function disjunction(): Truth {
    let left = conjunction();
    while (consume("or")) {
      const right = conjunction();
      left =
        left === true || right === true
          ? true
          : left === undefined || right === undefined
            ? undefined
            : false;
    }
    return left;
  }
  try {
    const result = disjunction();
    return valid && position === tokens.length ? result : undefined;
  } catch {
    return undefined;
  }
}

export function conditionSlots(expression: string | undefined): string[] {
  return (expression ? (tokenize(expression) ?? []) : []).filter(
    (token) =>
      /^[A-Za-z_][\w.]*/.test(token) && !["true", "false", "and", "or", "not"].includes(token),
  );
}
