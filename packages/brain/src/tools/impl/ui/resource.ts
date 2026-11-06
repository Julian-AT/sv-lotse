import { randomUUID } from "node:crypto";
import { isPortalLoginPage, loadPortalPolicy } from "@lotse/knowledge/portal-policy";
import type { ContextCapsule, Target } from "@lotse/protocol";
import { BOOKING_ALLOWLIST_FILE } from "../../../config/index.ts";
import { contracts } from "../../contracts/index.ts";
import type { Implementations, ToolDependencies } from "../../types.ts";

/**
 * Show-then-do guidance (PRD §4, §8): before pointing at a page, form or document the user does
 * not have open, the pilot checks the screen state, asks one short question and opens it on "yes".
 */
export const OPEN_AND_POINT_POLICY = `Check the user's state before on-screen guidance. When a step needs a specific official page, form or case document, compare it with the screen block (pageUrl, ocrLines, handles) and the open form instances. If it is not visibly open, call ui.offerResource with its target and a short name, then ask exactly one short question and stop: German "Soll ich <Name> für Sie öffnen?", English "Shall I open <name> for you?". No further explanation in that reply. Page targets are dom targets with the exact https URL from a tool result or source on an allowlisted origin and handle "page"; forms use the form target of a prepared form instance; documents use a text target with the case document id.
When the user agrees to an offered resource (for example "ja", "Ja, öffnen", "yes"), call ui.openResource with the same target and wait for its result. Only after success point at the relevant field or sentence with ui.point or ui.highlight (form target with a field id, dom handle from page data, or a short verbatim text quote visible on that page) and explain it in one or two short sentences. Form filling then follows the normal live-fill and approval rules. If opening fails, say so briefly and give the address instead. When the user declines an offer (for example "nein", "no"), do not drop the topic and do not open anything: in one or two sentences say where to find it, naming the site, the offered address and, if known from sources, the menu path or section heading.
If ui.offerResource reports open=true, do not ask; point at the relevant place right away.`;

let origins: Promise<readonly string[]> | undefined;
async function portalOrigins(): Promise<readonly string[]> {
  origins ??= loadPortalPolicy(BOOKING_ALLOWLIST_FILE).then((policy) =>
    policy.origins.map((entry) => entry.origin),
  );
  return origins;
}

/** HTTPS page without credentials on an exact allowlisted origin, never a login page. */
export function portalPageAllowed(raw: string, allowed: readonly string[]): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      allowed.includes(url.origin) &&
      !isPortalLoginPage(url)
    );
  } catch {
    return false;
  }
}

/** Server-side check for ui.offerResource and ui.openResource. Opening never submits anything. */
export async function openResourceAllowed(input: unknown): Promise<boolean> {
  const parsed = contracts["ui.openResource"].input.safeParse(input);
  if (!parsed.success) return false;
  const { target } = parsed.data;
  if (target.kind === "form") return true;
  if (target.kind === "text") return target.documentId !== undefined;
  if (target.kind === "dom") return portalPageAllowed(target.url, await portalOrigins());
  return false;
}

function samePage(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return (
      left.origin === right.origin &&
      left.pathname.replace(/\/$/, "") === right.pathname.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}

/** Whether the capsule shows the resource as already open. Unknown state counts as not open. */
export function resourceIsOpen(target: Target, capsule: ContextCapsule | undefined): boolean {
  const pageUrl = capsule?.page?.url;
  if (target.kind === "dom") return pageUrl !== undefined && samePage(pageUrl, target.url);
  if (target.kind === "form")
    return pageUrl?.includes(encodeURIComponent(target.formInstanceId)) ?? false;
  if (target.kind === "text" && target.documentId)
    return pageUrl?.includes(encodeURIComponent(target.documentId)) ?? false;
  return false;
}

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "ui.offerResource": async (raw) => {
      const input = contracts["ui.offerResource"].input.parse(raw);
      if (!(await openResourceAllowed({ target: input.target })))
        throw new Error("RESOURCE_NOT_ALLOWED");
      return {
        offerId: randomUUID(),
        open: resourceIsOpen(input.target, deps.capsule),
        label: input.label,
        target: input.target,
      };
    },
  };
}
