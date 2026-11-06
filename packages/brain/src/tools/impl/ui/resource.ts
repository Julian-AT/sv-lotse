import { randomUUID } from "node:crypto";
import { isPortalLoginPage, loadPortalPolicy } from "@lotse/knowledge/portal-policy";
import type { ContextCapsule, Target } from "@lotse/protocol";
import type { InferUIMessageChunk } from "ai";
import { BOOKING_ALLOWLIST_FILE } from "../../../config/index.ts";
import { contracts } from "../../contracts/index.ts";
import type { Implementations, LotseMessage, ToolDependencies } from "../../types.ts";

/**
 * Show-then-do guidance (PRD §4, §8): before pointing at a page, form or document the user does
 * not have open, the pilot checks the screen state, asks one short question and opens it on "yes".
 */
export const OPEN_AND_POINT_POLICY = `Be a fast, proactive helper: two or three short sentences, prefer results already in the conversation, point with ui.point at what you talk about, end with one short concrete offer of the next step.
Where/how to apply, find or fill something needs the page, form or document on screen. If the screen block or open forms do not show it, call ui.offerResource (dom target with an allowlisted https URL from results and handle "page", form target, or text target with documentId), ask only "Soll ich <Name> für Sie öffnen?" and stop; if open=true, point right away. On yes call ui.openResource with that target, then point at the field or sentence (form field, dom handle or short visible quote); a web page opens in the user's browser, use the page handles from the screen block or context.readPage. On no, say where to find it (site, address, menu path).`;

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

const GUIDANCE_REQUEST =
  /\b(?:wo|wie)\b[^?.!]{0,60}\b(?:beantrag|antrag|find|bekomm|einreich|formular|herunterlad|stell)|\bzeig(?:en)?\b[^?.!]{0,20}\bmir\b|\bwhere\b[^?.!]{0,40}\b(?:apply|find|get|submit)|\bshow me\b|\bhow do i apply\b/iu;
const CONFIRMATION = /^\s*(?:ja|jawohl|genau|ok(?:ay)?|yes|yep|richtig)\b[\s,.!]*\S{0,30}\s*$/iu;

/**
 * "Wo beantrage ich …?" and similar requests ask to be shown a page. A bare goal confirmation
 * ("Ja") carries the request of the user message before it.
 */
export function isGuidanceRequest(userTexts: readonly string[]): boolean {
  const [latest = "", previous = ""] = userTexts;
  return (
    GUIDANCE_REQUEST.test(latest) || (CONFIRMATION.test(latest) && GUIDANCE_REQUEST.test(previous))
  );
}

/** The most relevant allowlisted official page among this turn's sources, as an offer. */
export async function pageOffer(
  sources: readonly { url: string }[],
): Promise<{ target: Target; label: string } | undefined> {
  const allowed = await portalOrigins();
  const source = sources.find((item) => portalPageAllowed(item.url, allowed));
  if (!source) return;
  const host = new URL(source.url).hostname.replace(/^www\./u, "");
  return {
    target: { kind: "dom", handle: "page", url: source.url },
    label: `die offizielle Seite auf ${host}`,
  };
}

/** Server-side offer for a guidance request when the pilot did not offer or point itself. */
export async function guidanceOffer(input: {
  userTexts: readonly string[];
  sources: readonly { url: string }[];
}): Promise<{ target: Target; label: string } | undefined> {
  return isGuidanceRequest(input.userTexts) ? pageOffer(input.sources) : undefined;
}

/** The offer as a completed ui.offerResource call, followed by a new step for the question. */
export function offerChunks(
  toolCallId: string,
  offer: { target: Target; label: string },
): InferUIMessageChunk<LotseMessage>[] {
  return [
    { type: "start-step" },
    {
      type: "tool-input-available",
      toolCallId,
      toolName: "ui.offerResource",
      input: { target: offer.target, label: offer.label },
    },
    {
      type: "tool-output-available",
      toolCallId,
      output: { offerId: randomUUID(), open: false, label: offer.label, target: offer.target },
    },
    { type: "finish-step" },
    { type: "start-step" },
  ];
}

/** The user's earlier messages (without the current one), newest first, as plain text. */
export function recentUserTexts(history: readonly LotseMessage[], current = ""): string[] {
  const texts = history
    .filter((message) => message.role === "user")
    .map((message) =>
      message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" "),
    );
  if (texts.at(-1)?.trim() === current.trim()) texts.pop();
  return texts.slice(-2).reverse();
}

/** The latest assistant message opened a resource successfully (the turn continues after it). */
export function openedResource(history: readonly LotseMessage[]): boolean {
  const last = history.at(-1);
  if (last?.role !== "assistant") return false;
  return last.parts.some(
    (part) =>
      part.type === "tool-ui.openResource" &&
      "output" in part &&
      (part.output as { success?: unknown } | undefined)?.success === true,
  );
}

/** The conversation is answering an earlier open offer: never offer the same page again. */
export function answersOffer(history: readonly LotseMessage[], userText = ""): boolean {
  // A new where-to question is not an answer to the previous offer.
  if (GUIDANCE_REQUEST.test(userText)) return false;
  const assistant = history.findLast((message) => message.role === "assistant");
  return (
    assistant?.parts.some(
      (part) => part.type === "tool-ui.offerResource" || part.type === "tool-ui.openResource",
    ) ?? false
  );
}
