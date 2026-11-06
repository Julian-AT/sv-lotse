import { I18nError } from "./errors.ts";

export type MessageNode =
  | { kind: "text"; value: string }
  | { kind: "pound" }
  | { kind: "argument"; name: string; format: "text" | "number" | "date"; style: string }
  | { kind: "plural"; name: string; offset: number; branches: ReadonlyMap<string, MessageNode[]> };

const pluralSelectors = new Set(["zero", "one", "two", "few", "many", "other"]);

class MessageParser {
  private position = 0;

  constructor(private readonly source: string) {}

  parse(inPlural = false): MessageNode[] {
    const nodes: MessageNode[] = [];
    let text = "";
    const flush = (): void => {
      if (text) nodes.push({ kind: "text", value: text });
      text = "";
    };
    while (this.position < this.source.length) {
      const character = this.source[this.position++];
      switch (character) {
        case "}":
          if (!inPlural) throw new I18nError("INVALID_MESSAGE");
          flush();
          return nodes;
        case "{":
          flush();
          nodes.push(this.argument());
          break;
        case "#":
          if (inPlural) {
            flush();
            nodes.push({ kind: "pound" });
          } else text += character;
          break;
        case "'":
          text += this.quotedText();
          break;
        default:
          text += character;
      }
    }
    if (inPlural) throw new I18nError("INVALID_MESSAGE");
    flush();
    return nodes;
  }

  private quotedText(): string {
    const next = this.source[this.position];
    if (next === "'") {
      this.position++;
      return "'";
    }
    if (next !== "{" && next !== "}" && next !== "#") return "'";
    let text = "";
    while (this.position < this.source.length) {
      const character = this.source[this.position++];
      if (character !== "'") text += character;
      else if (this.source[this.position] === "'") {
        this.position++;
        text += "'";
      } else break;
    }
    return text;
  }

  private readUntil(delimiters: string): string {
    const start = this.position;
    while (this.position < this.source.length) {
      const character = this.source[this.position];
      if (character && delimiters.includes(character)) break;
      this.position++;
    }
    if (this.position === this.source.length) throw new I18nError("INVALID_MESSAGE");
    return this.source.slice(start, this.position).trim();
  }

  private argument(): MessageNode {
    const name = this.readUntil(",}");
    if (!/^[a-zA-Z_][\w.-]*$/.test(name)) throw new I18nError("INVALID_MESSAGE");
    if (this.source[this.position++] === "}") {
      return { kind: "argument", name, format: "text", style: "" };
    }
    const format = this.readUntil(",}");
    const delimiter = this.source[this.position++];
    if (format === "plural" && delimiter === ",") return this.plural(name);
    if (format !== "number" && format !== "date") throw new I18nError("INVALID_MESSAGE");
    const style = delimiter === "," ? this.readUntil("}") : "";
    if (delimiter === ",") this.position++;
    this.validateStyle(format, style);
    return { kind: "argument", name, format, style };
  }

  private validateStyle(format: "number" | "date", style: string): void {
    const styles =
      format === "number" ? ["", "integer", "percent"] : ["", "short", "medium", "long", "full"];
    if (!styles.includes(style)) throw new I18nError("INVALID_MESSAGE");
  }

  private plural(name: string): MessageNode {
    const offsetMatch = /^\s*offset:\s*(\d+)\s*/.exec(this.source.slice(this.position));
    const offset = Number(offsetMatch?.[1] ?? 0);
    if (!Number.isSafeInteger(offset)) throw new I18nError("INVALID_MESSAGE");
    this.position += offsetMatch?.[0].length ?? 0;
    const branches = new Map<string, MessageNode[]>();
    while (this.position < this.source.length) {
      const rawSelector = this.readUntil("{}");
      const selector = rawSelector.startsWith("=")
        ? `=${Number(rawSelector.slice(1))}`
        : rawSelector;
      if (this.source[this.position++] === "}") {
        if (selector || !branches.has("other")) throw new I18nError("INVALID_MESSAGE");
        return { kind: "plural", name, offset, branches };
      }
      if (!pluralSelectors.has(selector) && !/^=-?\d+(?:\.\d+)?$/.test(rawSelector)) {
        throw new I18nError("INVALID_MESSAGE");
      }
      if (branches.has(selector)) throw new I18nError("INVALID_MESSAGE");
      branches.set(selector, this.parse(true));
    }
    throw new I18nError("INVALID_MESSAGE");
  }
}

export function parseMessage(message: string): MessageNode[] {
  return new MessageParser(message).parse();
}
