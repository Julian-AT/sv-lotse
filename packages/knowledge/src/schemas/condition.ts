import { z } from "zod";

// Syntax only. Slot lookup, coercion and evaluation belong to the brain's process engine.
// or := and ('or' and)*; and := unary ('and' unary)*;
// unary := 'not' unary | '(' or ')' | operand (comparison operand)?
export function isCondition(expression: string): boolean {
  const tokens: string[] = [];
  const token =
    /\s*(>=|<=|==|!=|>|<|\(|\)|-?\d+(?:\.\d+)?|"(?:[^"\\\n]|\\["\\/bfnrt]|\\u[\da-fA-F]{4})*"|'(?:[^'\\\n]|\\['\\nrt])*'|[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)/y;
  let offset = 0;
  while (offset < expression.trimEnd().length) {
    token.lastIndex = offset;
    const match = token.exec(expression);
    if (!match?.[1]) return false;
    tokens.push(match[1]);
    offset = token.lastIndex;
  }
  let position = 0;
  const consume = (value: string) => tokens[position] === value && ++position > 0;
  function operand(): boolean {
    const value = tokens[position];
    if (!value || ["and", "or", "not", "(", ")", ">", "<", ">=", "<=", "==", "!="].includes(value))
      return false;
    position++;
    return true;
  }
  function unary(): boolean {
    if (consume("not")) return unary();
    if (consume("(")) return disjunction() && consume(")");
    if (!operand()) return false;
    if ([">", "<", ">=", "<=", "==", "!="].includes(tokens[position] ?? "")) {
      position++;
      return operand();
    }
    return true;
  }
  function conjunction(): boolean {
    if (!unary()) return false;
    while (consume("and")) if (!unary()) return false;
    return true;
  }
  function disjunction(): boolean {
    if (!conjunction()) return false;
    while (consume("or")) if (!conjunction()) return false;
    return true;
  }
  return disjunction() && position === tokens.length;
}
export const ConditionSchema = z.string().max(4096).refine(isCondition, "Invalid condition syntax");
