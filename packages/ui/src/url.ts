import { URL_SCHEMES } from "./config";

/** Keep caller-supplied links inert when their scheme could execute script. */
export function safeHref(href: string): string | undefined {
  const value = href.trim();
  if (/^(?:#|\/(?!\/)|\.\.?\/)/.test(value)) return value;
  try {
    const url = new URL(value);
    return URL_SCHEMES.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
