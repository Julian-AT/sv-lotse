import { INTL_LOCALES, type Locale } from "./config.ts";
import { I18nError } from "./errors.ts";
import { formatDate, formatNumber } from "./format.ts";
import { type MessageNode, parseMessage } from "./message-parser.ts";

export type MessageParams = Readonly<Record<string, string | number | Date>>;

function parameter(params: MessageParams, name: string): string | number | Date {
  const value = Object.hasOwn(params, name) ? params[name] : undefined;
  if (value === undefined) throw new I18nError("INVALID_PARAMETER");
  return value;
}

function numericParameter(params: MessageParams, name: string): number {
  const value = parameter(params, name);
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new I18nError("INVALID_PARAMETER");
  return value;
}

function argument(
  node: Extract<MessageNode, { kind: "argument" }>,
  locale: Locale,
  params: MessageParams,
): string {
  const value = parameter(params, node.name);
  if (node.format === "number") {
    const options =
      node.style === "integer"
        ? { maximumFractionDigits: 0 }
        : { style: node.style === "percent" ? ("percent" as const) : ("decimal" as const) };
    return formatNumber(locale, numericParameter(params, node.name), options);
  }
  if (node.format === "date") {
    if (!(value instanceof Date) && typeof value !== "number")
      throw new I18nError("INVALID_PARAMETER");
    // The parser validates these named ICU date styles before rendering.
    const dateStyle = (node.style || "short") as "short" | "medium" | "long" | "full";
    return formatDate(locale, value, { dateStyle });
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(locale, value);
  throw new I18nError("INVALID_PARAMETER");
}

function render(
  nodes: readonly MessageNode[],
  locale: Locale,
  params: MessageParams,
  count?: number,
): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return node.value;
        case "pound":
          return formatNumber(locale, count ?? 0);
        case "argument":
          return argument(node, locale, params);
        case "plural": {
          const value = numericParameter(params, node.name);
          const adjusted = value - node.offset;
          const category = new Intl.PluralRules(INTL_LOCALES[locale]).select(adjusted);
          const branch =
            node.branches.get(`=${value}`) ??
            node.branches.get(category) ??
            node.branches.get("other");
          if (!branch) throw new I18nError("INVALID_MESSAGE");
          return render(branch, locale, params, adjusted);
        }
      }
      throw new I18nError("INVALID_MESSAGE");
    })
    .join("");
}

export function formatMessage(message: string, locale: Locale, params: MessageParams = {}): string {
  return render(parseMessage(message), locale, params);
}
