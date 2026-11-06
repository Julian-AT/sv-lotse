import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { describe, expect, it } from "vitest";
import {
  benefitForm,
  openedPageUrl,
  openedPageWithoutForm,
  preparedFormAwaitingQuestion,
  prepareFormAfterOpen,
  topicTexts,
} from "../../src/conversation/form-after-open.ts";
import type { LotseMessage } from "../../src/tools/types.ts";

const page = { kind: "dom", handle: "page", url: "https://www.pv.at/pflegegeld" };

function user(text: string): LotseMessage {
  return { id: randomUUID(), role: "user", parts: [{ type: "text", text }] };
}

function opened(target: unknown, extra: LotseMessage["parts"] = []): LotseMessage {
  return {
    id: randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "tool-ui.openResource",
        toolCallId: randomUUID(),
        state: "output-available",
        input: { target },
        output: { success: true },
      },
      ...extra,
    ] as LotseMessage["parts"],
  };
}

const prefilled = { formInstanceId: randomUUID(), proposals: [], missingFields: ["f001"] };
const prefillPart = {
  type: "tool-form.prefill",
  toolCallId: randomUUID(),
  state: "output-available",
  input: {},
  output: prefilled,
} as unknown as LotseMessage["parts"][number];
const formTarget = { kind: "form", formInstanceId: prefilled.formInstanceId, fieldId: "f001" };

function formOpen(state: "input-available" | "output-available"): LotseMessage["parts"][number] {
  return {
    type: "tool-ui.openResource",
    toolCallId: randomUUID(),
    state,
    input: { target: formTarget },
    ...(state === "output-available" ? { output: { success: true } } : {}),
  } as unknown as LotseMessage["parts"][number];
}

describe("benefitForm", () => {
  it("maps benefits to their registered forms", () => {
    expect(benefitForm(["Wo beantrage ich Pflegegeld?"])?.formId).toBe("svbox-pflegegeld");
    expect(benefitForm(["Fahrtkosten zur Dialyse"])?.formId).toBe("svbox-fahrtkosten-wien");
    expect(benefitForm(["Reha nach einem Unfall"])?.formId).toBe("svbox-reha-unfall");
    expect(benefitForm(["Ich möchte auf Kur"])?.formId).toBe("svbox-kur-reha");
    expect(benefitForm(["Wie komme ich zu einer Wohnung?"])).toBeUndefined();
  });

  it("prefers the newest matching text", () => {
    expect(benefitForm(["Ja, öffnen", "Pflegegeld beantragen", "Kur"])?.formId).toBe(
      "svbox-pflegegeld",
    );
  });
});

describe("after a page opened", () => {
  const history = [user("Ich möchte Pflegegeld für meine Mutter beantragen"), opened(page)];

  it("detects a successful page open without a prepared form", () => {
    expect(openedPageWithoutForm(history)).toBe(true);
    expect(openedPageUrl(history)).toBe(page.url);
    expect(preparedFormAwaitingQuestion(history)).toBeUndefined();
    expect(topicTexts(history)[1]).toContain("Pflegegeld");
  });

  it("does not prepare twice and does not treat a form open as a page", () => {
    const pending = [
      history[0] as LotseMessage,
      opened(page, [prefillPart, formOpen("input-available")]),
    ];
    expect(openedPageWithoutForm(pending)).toBe(false);
    expect(preparedFormAwaitingQuestion(pending)).toBeUndefined();
    expect(openedPageWithoutForm([history[0] as LotseMessage, opened(formTarget)])).toBe(false);
  });

  it("asks once after the form viewer reported back", () => {
    const settled = opened(page, [prefillPart, formOpen("output-available")]);
    expect(preparedFormAwaitingQuestion([settled])).toEqual(prefilled);
    const asked = {
      ...settled,
      parts: [...settled.parts, { type: "text", text: "Was soll ich eintragen?" }],
    } as LotseMessage;
    expect(preparedFormAwaitingQuestion([asked])).toBeUndefined();
  });

  it("leaves L1, helpers and unrelated turns to the agent without touching the case", async () => {
    const untouchable = new Proxy({} as DatabaseClient, {
      get: () => {
        throw new Error("database touched");
      },
    });
    const context = {
      caseId: randomUUID(),
      subjectId: randomUUID(),
      actorId: randomUUID(),
      userId: randomUUID(),
      sessionId: randomUUID(),
      actorRole: "subject" as const,
      autonomyLevel: "L3" as const,
      shareScope: {},
      sentenceIndex: 0,
    };
    const run = (overrides: object, messages: LotseMessage[]) =>
      prepareFormAfterOpen({
        db: untouchable,
        context: { ...context, ...overrides },
        history: messages,
        writer: { write: () => {} },
      });
    await expect(run({ autonomyLevel: "L1" }, history)).resolves.toBeUndefined();
    await expect(run({ actorRole: "helper" }, history)).resolves.toBeUndefined();
    const housing = { kind: "dom", handle: "page", url: "https://www.wien.gv.at/wohnen" };
    await expect(
      run({}, [user("Wie komme ich zu einer Wohnung?"), opened(housing)]),
    ).resolves.toBeUndefined();
    await expect(run({}, [user("Pflegegeld")])).resolves.toBeUndefined();
  });
});
