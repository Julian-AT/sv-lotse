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
export const OPEN_AND_POINT_POLICY = `Be a fast, proactive helper: two or three short sentences, prefer results already in the conversation, point with ui.point at what you talk about, end with one short concrete offer of the next step.
Where/how to apply, find or fill something needs the page, form or document on screen. If the screen block or open forms do not show it, call ui.offerResource (dom target with an allowlisted https URL from results and handle "page", form target, or text target with documentId), ask only "Soll ich <Name> für Sie öffnen?" and stop; if open=true, point right away. On yes call ui.openResource with that target, then point at the field or sentence (form field, dom handle or short visible quote). On no, say where to find it (site, address, menu path).`;

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
