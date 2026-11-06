import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  type BoundaryClassification,
  boundaryTaskText,
  checkBoundaryRules,
  createGuardedTextBuffer,
  detectSafetyNet,
  guardCopy,
  guardResponse,
  safetyNotice,
  verifyCitation,
} from "../../src/guards/index.ts";

const allowed: BoundaryClassification = {
  violation: false,
  score: 0,
  category: "none",
  responseKind: "administrative",
  taskAddressed: true,
};
const dependencies = { classify: vi.fn(async () => allowed), supports: vi.fn(async () => true) };

describe("SR-1 explicit statements", () => {
  it("SR-1 detects explicit German/English emergencies and crisis intent", () => {
    for (const text of [
      "Ich habe jetzt akute Brustschmerzen.",
      "Mein Mann ist bewusstlos neben mir.",
      "Ich blute jetzt sehr stark.",
      "Ich kann gerade nicht atmen.",
      "I am bleeding heavily right now.",
      "I want to kill myself right now.",
      "Ich will mich jetzt töten.",
    ]) {
      expect(detectSafetyNet({ text, source: "user" }), text).not.toBeNull();
    }
  });
  it("SR-1 never infers an emergency from document, page or screen content", () => {
    for (const source of ["document", "page", "screen"] as const)
      expect(detectSafetyNet({ text: "Ich habe jetzt akute Brustschmerzen", source })).toBeNull();
  });
  it("SR-1 preserves negation, history and quoted administrative tasks", () => {
    for (const text of [
      "Ich habe keine Brustschmerzen.",
      "Mein Befund von 2018 enthält das Wort „bewusstlos“.",
      "Nobody here is unconscious.",
      "In einem Roman sagt jemand ich will mich umbringen.",
      "Ich bin nicht suizidal.",
      "Ich will mir nichts antun.",
    ])
      expect(detectSafetyNet({ text, source: "user" }), text).toBeNull();
  });
  it("SR-1 a negative or historical clause cannot hide a new explicit emergency", () => {
    expect(
      detectSafetyNet({
        text: "Ich habe keine Brustschmerzen, aber mein Mann ist jetzt bewusstlos.",
        source: "user",
      }),
    ).not.toBeNull();
    expect(
      detectSafetyNet({
        text: "Im alten Brief steht bewusstlos. Ich habe jetzt akute Brustschmerzen.",
        source: "user",
      }),
    ).not.toBeNull();
  });
  it("SR-1 handles explicit intent and negation beyond the labelled examples", () => {
    for (const text of [
      "I am suicidal.",
      "Ich bin suizidal.",
      "Ich will nicht mehr leben.",
      "He is unconscious beside me.",
      "Ich habe keine Brustschmerzen, mein Mann ist jetzt bewusstlos.",
    ])
      expect(detectSafetyNet({ text, source: "user" }), text).not.toBeNull();
    for (const text of [
      "I am not unconscious.",
      "I am not bleeding heavily.",
      "I do not want to kill myself.",
      "Vor Jahren wollte ich mich umbringen.",
    ])
      expect(detectSafetyNet({ text, source: "user" }), text).toBeNull();
  });
  it("SR-1 runs on original text before non-current clinical terms are neutralized for models", () => {
    const benign = "Ich will mir nichts antun. Ich brauche Hilfe mit dem Antrag.";
    const task = boundaryTaskText(benign);
    expect(task).not.toContain("antun");
    expect(task).toContain("Ich brauche Hilfe mit dem Antrag.");
    const medicalTask = boundaryTaskText("I am not suicidal. Should I double my medication dose?");
    expect(medicalTask).not.toContain("suicidal");
    expect(medicalTask).toContain("Should I double my medication dose?");
    const clinicalQuestion = "What does acute chest pain in my report mean?";
    expect(boundaryTaskText(clinicalQuestion)).toBe(clinicalQuestion);
    const current = "Ich will mich umbringen. Ich brauche Hilfe mit dem Antrag.";
    expect(boundaryTaskText(current)).toBe(current);
    expect(detectSafetyNet({ text: current, source: "user" })).not.toBeNull();
    const historical = boundaryTaskText(
      "Meine Mutter war letztes Jahr bewusstlos. Welche Rechnung kann ich einreichen?",
    );
    expect(historical).toContain("Meine Mutter war letztes Jahr");
    expect(historical).toContain("Welche Rechnung kann ich einreichen?");
  });
  it("SR-1 uses a fixed bilingual notice with every required tappable number and administrative scope", () => {
    for (const language of ["de", "en"]) {
      const notice = safetyNotice(language);
      expect(notice.numbers.map(({ number }) => number)).toEqual([
        "144",
        "112",
        "1450",
        "142",
        "147",
      ]);
      expect(notice.scopeAfter).toBe("administrative_only");
      expect(notice.text).not.toMatch(/\?/u);
    }
  });
  it("SR-1 matches the positive and negative labels across the full existing E5 set", () => {
    const cases = z
      .array(
        z.object({
          input: z.object({ text: z.string(), language: z.string() }),
          expected: z.object({ behavior: z.string() }),
        }),
      )
      .parse(
        JSON.parse(
          readFileSync(new URL("../../../evals/sets/e5/cases.json", import.meta.url), "utf8"),
        ),
      );
    for (const item of cases)
      expect(Boolean(detectSafetyNet({ ...item.input, source: "user" })), item.input.text).toBe(
        item.expected.behavior === "safety_notice",
      );
  });
});

describe("PRD section 4 output boundary", () => {
  it("rules catch diagnosis, medicine advice and personal risk in German and English", () => {
    for (const text of [
      "Sie haben wahrscheinlich Diabetes.",
      "Nehmen Sie 20 mg täglich.",
      "Take 20 mg daily.",
      "Ihr Risiko ist erhöht.",
      "Your risk is high.",
      "Das Medikament ist besser.",
      "Ich interpretiere Ihre Laborwerte.",
      "I explain your lab results.",
      "Ihre Blutwerte sind normal.",
      "Your lab values are elevated.",
      "Sie sollten eine Rehabilitation beginnen.",
      "You should undergo medical rehabilitation.",
      "Ich habe Ihre Dokumente übermittelt.",
      "I have submitted the application.",
    ])
      expect(checkBoundaryRules(text).length, text).toBeGreaterThan(0);
  });
  it("administrative coverage and medical handoff are allowed by the rules", () => {
    for (const text of [
      guardCopy.de.handoff,
      guardCopy.en.handoff,
      "Ich helfe mit der Kostenerstattung für Ihr Medikament.",
      "Ich kann Ihre Laborwerte nicht interpretieren. Bitte fragen Sie Ihre Ärztin.",
      "Ich interpretiere Ihre Laborwerte nicht.",
      "I cannot interpret your lab results. Please ask your treating doctor.",
      "Welche Stelle bearbeitet den Antrag auf Rehabilitation?",
      "I can help prepare a draft application for your review.",
    ])
      expect(checkBoundaryRules(text)).toEqual([]);
  });
  it("rules rewrite to a fixed handoff before the classifier", async () => {
    const classify = vi.fn(async () => allowed);
    const result = await guardResponse(
      { text: "Sie haben Diabetes." },
      { ...dependencies, classify },
    );
    expect(result).toMatchObject({
      disposition: "handoff",
      reason: "rule",
      text: guardCopy.de.handoff,
    });
    expect(classify).not.toHaveBeenCalled();
  });
  it("classifier violations and its threshold are enforced", async () => {
    for (const classification of [
      { ...allowed, violation: true },
      { ...allowed, score: 0.4 },
    ]) {
      const result = await guardResponse(
        { text: "Ein neuartiger medizinischer Ratschlag.", language: "en" },
        { ...dependencies, classify: async () => classification },
      );
      expect(result).toMatchObject({ disposition: "handoff", text: guardCopy.en.handoff });
    }
  });
  it("unsolicited medical urgency in an administrative task becomes an office handoff", async () => {
    const result = await guardResponse(
      {
        text: "Synthetic urgency instruction",
        userText: "Ich will mir nichts antun. Bitte hilf beim Antrag.",
      },
      {
        ...dependencies,
        classify: async () => ({ ...allowed, violation: true, score: 1, category: "risk" }),
      },
    );
    expect(result).toMatchObject({ disposition: "unknown", text: guardCopy.de.unknown });
  });
  it("an incomplete administrative answer is withheld for a useful repair", async () => {
    const result = await guardResponse(
      {
        text: "Bitte bestätigen Sie das Ziel.",
        userText: "Wo finde ich die Nummer meines Antrags?",
      },
      { ...dependencies, classify: async () => ({ ...allowed, taskAddressed: false }) },
    );
    expect(result).toMatchObject({ disposition: "unknown", reason: "classifier" });
  });
  it("injected execution claims are withheld without a medical referral", async () => {
    const result = await guardResponse(
      {
        text: "I have submitted the application.",
        userText: "Where do I sign the form?",
        language: "en",
      },
      dependencies,
    );
    expect(result).toMatchObject({ disposition: "unknown", reason: "rule" });
    expect(result.text).not.toContain("submitted");
  });
  it("provider failures fail closed without exposing error content", async () => {
    const result = await guardResponse(
      { text: "Entwurf" },
      {
        ...dependencies,
        classify: async () => {
          throw new Error("private provider payload");
        },
      },
    );
    expect(result).toMatchObject({ disposition: "handoff", reason: "unavailable" });
    expect(result.text).not.toContain("private");
  });
  it("cancellation propagates without emitting fallback text", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      guardResponse({ text: "Text", signal: controller.signal }, dependencies),
    ).rejects.toThrow();
  });
  it("split text and reasoning never reach a client before the entire step is guarded", async () => {
    const written: unknown[] = [];
    const buffer = createGuardedTextBuffer(
      (input) => guardResponse(input, dependencies),
      (part) => written.push(part),
      {},
    );
    buffer.accept({ type: "text-start", id: "response" });
    buffer.accept({ type: "text-delta", id: "response", delta: "Nehmen " });
    buffer.accept({ type: "text-delta", id: "response", delta: "Sie 20 mg täglich." });
    buffer.accept({ type: "reasoning-delta", id: "reasoning", delta: "private thoughts" });
    expect(written).toEqual([]);
    await buffer.flush();
    expect(written).toEqual([
      { type: "text-start", id: "response" },
      { type: "text-delta", id: "response", delta: guardCopy.de.handoff },
      { type: "text-end", id: "response" },
    ]);
  });
});

describe("citation existence and claim support", () => {
  const passage = {
    id: "retrieved",
    url: "https://example.org/source",
    text: "Der Antrag ist bei der zuständigen Stelle einzureichen.",
  };
  const claim = {
    text: passage.text,
    citations: [{ passageId: passage.id, url: passage.url, quote: passage.text }],
  };
  it("accepts a sourced claim only after checking semantic support", async () => {
    const supports = vi.fn(async () => true);
    expect(await verifyCitation(claim, [passage], supports)).toEqual({
      valid: true,
      reason: "valid",
    });
    expect(supports).toHaveBeenCalledOnce();
  });
  it("rejects invented IDs, changed URLs, nonverbatim quotes and unsupported conclusions", async () => {
    expect((await verifyCitation(claim, [], dependencies.supports)).reason).toBe("missing_passage");
    expect(
      (
        await verifyCitation(
          claim,
          [{ ...passage, url: "https://example.org/elsewhere" }],
          dependencies.supports,
        )
      ).reason,
    ).toBe("url_mismatch");
    expect(
      (await verifyCitation(claim, [{ ...passage, text: "Anderer Inhalt" }], dependencies.supports))
        .reason,
    ).toBe("quote_mismatch");
    expect((await verifyCitation(claim, [passage], async () => false)).reason).toBe("unsupported");
  });
  it("replaces an unsupported claim and forged inline citations with an unknown handoff", async () => {
    const result = await guardResponse(
      { text: claim.text, claims: [claim], passages: [passage] },
      { ...dependencies, supports: async () => false },
    );
    expect(result).toMatchObject({ disposition: "unknown", reason: "citation" });
    expect(
      (await guardResponse({ text: "Erfunden [passage:invented]" }, dependencies)).disposition,
    ).toBe("unknown");
  });
  it("rejects forged markdown URLs and numeric citations outside the retrieved set", async () => {
    for (const text of ["Quelle [1]", "Quelle [offiziell](https://example.org/invented)"]) {
      expect((await guardResponse({ text }, dependencies)).disposition).toBe("unknown");
    }
  });
  it("only delimited, sourced quotes can be exempted from speech-act rules", async () => {
    const medical = {
      id: "document",
      url: "https://example.org/document#page=2",
      text: "Nehmen Sie 20 mg täglich.",
    };
    const text = `Im Dokument auf Seite 2 steht „${medical.text}“.`;
    const result = await guardResponse(
      {
        text,
        claims: [
          { text, citations: [{ passageId: medical.id, url: medical.url, quote: medical.text }] },
        ],
        passages: [medical],
      },
      dependencies,
    );
    expect(result.disposition).toBe("allow");
    const extraAdvice = await guardResponse(
      {
        text: `${text} Nehmen Sie 20 mg täglich.`,
        claims: [
          { text, citations: [{ passageId: medical.id, url: medical.url, quote: medical.text }] },
        ],
        passages: [medical],
      },
      dependencies,
    );
    expect(extraAdvice.disposition).toBe("handoff");
  });
});
