// @vitest-environment jsdom
import type { LotseMessage } from "@lotse/brain";
import type { Action } from "@lotse/protocol";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createClientRuntime } from "../src/conversation/client-tools.ts";
import { pendingOfferQuestion, pendingOpenOffer } from "../src/conversation/open-offer.tsx";
import {
  formFieldElementId,
  OPEN_RESOURCE_CONFIG,
  openPortalPageNow,
  receiveNativeActionResult,
} from "../src/conversation/open-resource.ts";

const guide = vi.hoisted(() => ({
  execute: vi.fn(async (action: Action) => ({
    actionId: action.id,
    resolvedBy: "dom",
    success: true,
    confidence: 1,
  })),
  clear: vi.fn(),
  dispose: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@lotse/guide", () => ({ createGuide: () => guide, toCapsulePage: vi.fn() }));
const mounted = vi.hoisted(() => new Set<string>());
vi.mock("../src/features/form-viewer/workspace.tsx", () => ({
  dispatchFormAction: vi.fn(),
  formViewerMounted: (id: string) => mounted.has(id),
}));

const allowed = "https://portal.example.at";
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ origins: [allowed] })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mounted.clear();
  delete window.webkit;
});

const page = (url: string) => ({ target: { kind: "dom", handle: "page", url } });

test("opens an allowlisted portal page in the browser and reports success", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  const result = await createClientRuntime().execute(
    "open-1",
    "ui.openResource",
    page(`${allowed}/pflegegeld`),
  );
  expect(open).toHaveBeenCalledWith(`${allowed}/pflegegeld`, "_blank", expect.any(String));
  expect(result).toEqual({
    output: expect.objectContaining({ actionId: "open-1", success: true }),
  });
});

test("never opens a page outside the portal allowlist", async () => {
  const open = vi.spyOn(window, "open");
  for (const url of ["https://evil.example/x", "http://portal.example.at/x"]) {
    const result = await createClientRuntime().execute("open-2", "ui.openResource", page(url));
    expect(result).toEqual({
      output: expect.objectContaining({ success: false, failureReason: "origin-not-allowed" }),
    });
  }
  expect(open).not.toHaveBeenCalled();
});

test("reports a blocked popup instead of claiming success", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const result = await createClientRuntime().execute(
    "open-3",
    "ui.openResource",
    page(`${allowed}/a`),
  );
  expect(result).toEqual({
    output: expect.objectContaining({ success: false, failureReason: "POPUP_BLOCKED" }),
  });
});

test("a page opened from the offer chip is not opened twice", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  await createClientRuntime().execute("warm", "ui.openResource", page(`${allowed}/warm`));
  open.mockClear();
  expect(openPortalPageNow(`${allowed}/b`)).toBe(true);
  const result = await createClientRuntime().execute(
    "open-4",
    "ui.openResource",
    page(`${allowed}/b`),
  );
  expect(open).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ output: expect.objectContaining({ success: true }) });
});

test("on Mac the guided window opens through the bridge and its ActionResult is returned", async () => {
  const postMessage = vi.fn();
  window.webkit = { messageHandlers: { lotse: { postMessage } } };
  const pending = createClientRuntime().execute("open-5", "ui.openResource", page(`${allowed}/c`));
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
  expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
    type: "Action",
    payload: { id: "open-5", kind: "openResource", target: { kind: "dom", url: `${allowed}/c` } },
  });
  expect(
    receiveNativeActionResult({
      actionId: "open-5",
      resolvedBy: "dom",
      confidence: 1,
      success: true,
    }),
  ).toBe(true);
  expect(await pending).toEqual({ output: expect.objectContaining({ success: true }) });
});

test("on Mac a page opened in the browser is read and filled natively", async () => {
  const postMessage = vi.fn();
  window.webkit = { messageHandlers: { lotse: { postMessage } } };
  const runtime = createClientRuntime();
  const opened = runtime.execute("open-7", "ui.openResource", page(`${allowed}/d`));
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
  receiveNativeActionResult({ actionId: "open-7", resolvedBy: "ax", confidence: 1, success: true });
  await opened;
  expect(await runtime.execute("read-1", "context.readPage", {})).toEqual({ native: true });
  expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "ToolInvocation",
    payload: { toolCallId: "read-1", toolName: "context.readPage" },
  });
  const fill = {
    target: { kind: "dom", handle: "ax-1", url: `${allowed}/d` },
    value: "Anna",
    provenance: { source: { kind: "statement", quote: "Anna" } },
  };
  expect(await runtime.execute("fill-1", "ui.fill", fill)).toEqual({ native: true });
  expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "ToolInvocation",
    payload: { toolCallId: "fill-1", toolName: "ui.fill" },
  });
  const local = { ...fill, target: { ...fill.target, url: `${window.location.origin}/x` } };
  await runtime.execute("fill-2", "ui.fill", local);
  expect(guide.execute).toHaveBeenCalledWith(expect.objectContaining({ id: "fill-2" }));
});

test("opens a workspace form instance and waits for its viewer", async () => {
  const opened = vi.fn();
  window.addEventListener(OPEN_RESOURCE_CONFIG.openFormEvent, opened);
  const pending = createClientRuntime().execute("open-6", "ui.openResource", {
    target: { kind: "form", formInstanceId: "instance-1", fieldId: "name" },
  });
  await vi.waitFor(() => expect(opened).toHaveBeenCalled());
  window.dispatchEvent(
    new CustomEvent(OPEN_RESOURCE_CONFIG.formReadyEvent, { detail: "instance-1" }),
  );
  expect(await pending).toEqual({ output: expect.objectContaining({ success: true }) });
});

test("points at a form field through its element id", async () => {
  await createClientRuntime().action({
    id: "point-1",
    kind: "point",
    sentenceIndex: 0,
    target: { kind: "form", formInstanceId: "instance-1", fieldId: "name" },
    payload: {},
  });
  expect(guide.execute).toHaveBeenCalledWith(
    expect.objectContaining({ target: { kind: "ui", elementId: formFieldElementId("name") } }),
  );
});

test("offer chips appear only for an unopened resource of the latest assistant message", () => {
  const offer = (open: boolean): LotseMessage[] => [
    {
      id: "a",
      role: "assistant",
      parts: [
        {
          type: "tool-ui.offerResource",
          toolCallId: "t",
          state: "output-available",
          input: {},
          output: {
            offerId: "o",
            open,
            label: "Antragsseite",
            target: page(`${allowed}/d`).target,
          },
        },
        { type: "text", text: "Soll ich die Antragsseite für Sie öffnen?" },
      ],
    } as LotseMessage,
  ];
  expect(pendingOpenOffer(offer(false))).toMatchObject({ label: "Antragsseite" });
  expect(pendingOpenOffer(offer(true))).toBeUndefined();
  expect(
    pendingOpenOffer([...offer(false), { id: "u", role: "user", parts: [] } as LotseMessage]),
  ).toBeUndefined();
});

test("yes/no chips appear for a proactive offer question", () => {
  const reply = (text: string): LotseMessage[] => [
    { id: "a", role: "assistant", parts: [{ type: "text", text }] } as LotseMessage,
  ];
  expect(
    pendingOfferQuestion(
      reply("Den Antrag stellen Sie bei der PVA. Soll ich Ihnen zeigen, wo das steht?"),
    ),
  ).toBeDefined();
  expect(pendingOfferQuestion(reply("Shall I open the form?"))).toBeDefined();
  expect(pendingOfferQuestion(reply("Welche Versicherung haben Sie?"))).toBeUndefined();
  expect(pendingOfferQuestion(reply("Soll ich das tun? Das ist erledigt."))).toBeUndefined();
});
