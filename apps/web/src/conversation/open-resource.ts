import { allowedPortalUrl } from "@lotse/guide/portal";
import {
  type Action,
  type ActionResult,
  type BridgeToNative,
  PROTOCOL_VERSION,
  type Target,
  TargetSchema,
} from "@lotse/protocol";
import { z } from "zod";
import { hasNativeBridge, postNative } from "../bridge/index.ts";
import { GUIDED_PORTAL_CONFIG } from "../features/guided-portal/config.ts";

export const OPEN_RESOURCE_CONFIG = {
  portalsUrl: "/api/guide/portals",
  /** Native guided window: page load plus guide runtime injection. */
  nativeTimeoutMs: 30_000,
  formTimeoutMs: 15_000,
  /** A page opened by the "Ja, öffnen" click counts as open for the following tool call. */
  offerReuseMs: 120_000,
  openFormEvent: "lotse:open-form",
  formReadyEvent: "lotse:form-ready",
} as const;

export const OpenResourceInputSchema = z.object({
  target: TargetSchema,
  label: z.string().optional(),
});

let portalOrigins: Promise<readonly string[]> | undefined;
let loadedOrigins: readonly string[] = [];
/** The server's portal policy origins; the client re-checks every page before opening it. */
export function loadPortalOrigins(): Promise<readonly string[]> {
  portalOrigins ??= fetch(OPEN_RESOURCE_CONFIG.portalsUrl)
    .then(async (response) => {
      if (!response.ok) throw new Error("PORTALS_UNAVAILABLE");
      loadedOrigins = z
        .object({ origins: z.array(z.string()) })
        .parse(await response.json()).origins;
      return loadedOrigins;
    })
    .catch(() => {
      portalOrigins = undefined;
      return [];
    });
  return portalOrigins;
}

const openedPages = new Map<string, number>();
/** Opens an allowlisted page from a user gesture (the offer chip), so no popup blocker interferes. */
export function openPortalPageNow(url: string): boolean {
  const allowed = allowedPortalUrl(url, loadedOrigins);
  if (!allowed) return false;
  const popup = window.open(allowed, "_blank", GUIDED_PORTAL_CONFIG.windowFeatures);
  if (popup) openedPages.set(allowed, Date.now());
  return popup !== null;
}

const nativeWaiters = new Map<string, (result: ActionResult) => void>();
/** Feed bridge ActionResults here; returns true when an open request was waiting for it. */
export function receiveNativeActionResult(result: ActionResult): boolean {
  const waiter = nativeWaiters.get(result.actionId);
  if (!waiter) return false;
  nativeWaiters.delete(result.actionId);
  waiter(result);
  return true;
}

const failure = (
  actionId: string,
  failureReason: string,
  resolvedBy: ActionResult["resolvedBy"] = "ui",
): ActionResult => ({ actionId, resolvedBy, confidence: 0, success: false, failureReason });
const success = (
  actionId: string,
  resolvedBy: ActionResult["resolvedBy"] = "ui",
): ActionResult => ({
  actionId,
  resolvedBy,
  confidence: 1,
  success: true,
});

export const formFieldElementId = (fieldId: string): string => `lotse-form-field-${fieldId}`;

/** Point/highlight at a form field in the mounted workspace form viewer via its element id. */
export function formFieldUiTarget(target: Target): Target | undefined {
  if (target.kind !== "form") return;
  return { kind: "ui", elementId: formFieldElementId(target.fieldId) };
}

let nativePageOpenedAt = 0;
/** Mac app: a portal page was opened natively (default browser or guided window) this session. */
export function nativePageOpen(): boolean {
  return nativePageOpenedAt > 0;
}

async function openNative(id: string, target: Target, label?: string): Promise<ActionResult> {
  const action: Action = {
    id,
    kind: "openResource",
    target,
    payload: label ? { label } : {},
    sentenceIndex: 0,
  };
  const result = new Promise<ActionResult>((resolve) => {
    nativeWaiters.set(id, resolve);
    setTimeout(() => {
      if (nativeWaiters.delete(id)) resolve(failure(id, "OPEN_TIMEOUT", "dom"));
    }, OPEN_RESOURCE_CONFIG.nativeTimeoutMs);
  });
  const envelope: BridgeToNative = {
    v: PROTOCOL_VERSION,
    id: crypto.randomUUID(),
    type: "Action",
    payload: action,
  } as BridgeToNative;
  await postNative(envelope);
  const outcome = await result;
  if (outcome.success && target.kind === "dom") nativePageOpenedAt = Date.now();
  return outcome;
}

function openForm(id: string, formInstanceId: string, mounted: (id: string) => boolean) {
  return new Promise<ActionResult>((resolve) => {
    const done = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail !== formInstanceId) return;
      window.removeEventListener(OPEN_RESOURCE_CONFIG.formReadyEvent, done);
      clearTimeout(timer);
      resolve(success(id));
    };
    const timer = setTimeout(() => {
      window.removeEventListener(OPEN_RESOURCE_CONFIG.formReadyEvent, done);
      resolve(failure(id, "FORM_VIEWER_UNAVAILABLE"));
    }, OPEN_RESOURCE_CONFIG.formTimeoutMs);
    window.addEventListener(OPEN_RESOURCE_CONFIG.formReadyEvent, done);
    window.dispatchEvent(
      new CustomEvent(OPEN_RESOURCE_CONFIG.openFormEvent, { detail: formInstanceId }),
    );
    if (mounted(formInstanceId)) done(new CustomEvent("ready", { detail: formInstanceId }));
  });
}

/**
 * ui.openResource: opens an allowlisted portal page (Mac: guided window; browser: new window),
 * a workspace form instance or a case document, and resolves once it is ready. Never submits.
 */
export async function openResource(
  id: string,
  input: unknown,
  options: {
    formMounted: (formInstanceId: string) => boolean;
    openDocument?: ((action: Action) => void) | undefined;
  },
): Promise<ActionResult> {
  const parsed = OpenResourceInputSchema.safeParse(input);
  if (!parsed.success) return failure(id, "INVALID_RESOURCE");
  const { target, label } = parsed.data;
  if (target.kind === "dom") {
    const allowed = allowedPortalUrl(target.url, await loadPortalOrigins());
    if (!allowed) return failure(id, "origin-not-allowed", "dom");
    if (hasNativeBridge()) return openNative(id, { ...target, url: allowed }, label);
    const openedAt = openedPages.get(allowed);
    if (openedAt && Date.now() - openedAt < OPEN_RESOURCE_CONFIG.offerReuseMs) {
      openedPages.delete(allowed);
      return success(id, "dom");
    }
    const popup = window.open(allowed, "_blank", GUIDED_PORTAL_CONFIG.windowFeatures);
    return popup ? success(id, "dom") : failure(id, "POPUP_BLOCKED", "dom");
  }
  if (target.kind === "form") return openForm(id, target.formInstanceId, options.formMounted);
  if (target.kind === "text" && target.documentId && options.openDocument) {
    options.openDocument({ id, kind: "highlight", target, payload: {}, sentenceIndex: 0 });
    return success(id);
  }
  return failure(id, "RESOURCE_UNSUPPORTED");
}
