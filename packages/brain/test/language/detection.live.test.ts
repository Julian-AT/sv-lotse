import { expect, it } from "vitest";
import { parseBrainConfig } from "../../src/config/index.ts";
import { handleTurn } from "../../src/conversation/index.ts";
import { detectCommunicationPreferences } from "../../src/language/detect.ts";
import { readProfileSettings } from "../../src/language/settings.ts";
import { createModelRouter } from "../../src/models/index.ts";
import { chunks, identity, isolatedDatabase, turn, userMessage } from "../runtime/helpers.ts";

it("FR-L1 detects English speech with German form labels and German requests", async () => {
  const model = createModelRouter(parseBrainConfig()).modelFor("classifier");
  const english = await detectCommunicationPreferences(
    'Please help me complete this application. The German label is "Familienname". What should I enter there?',
    model,
  );
  expect(english.detectedLanguage).toBe("en");
  expect(english.requestedLanguage).toBeNull();
  const german = await detectCommunicationPreferences(
    "Ich brauche Hilfe mit diesem Antrag. Welche Unterlagen soll ich mitbringen?",
    model,
  );
  expect(german.detectedLanguage).toBe("de");
});

it("FR-L2 and FR-L3 detect explicit voice toggles in both directions", async () => {
  const model = createModelRouter(parseBrainConfig()).modelFor("classifier");
  const simple = await detectCommunicationPreferences(
    "Bitte antworte ab jetzt in einfacher Sprache. Sag du zu mir und halte deine Antworten kurz.",
    model,
  );
  expect(simple).toMatchObject({
    simpleLanguage: true,
    register: "informal",
    detailLevel: "brief",
  });
  const standard = await detectCommunicationPreferences(
    "Please answer in English. Turn off simple language, address me formally and explain the administrative steps in detail.",
    model,
  );
  expect(standard).toMatchObject({
    requestedLanguage: "en",
    simpleLanguage: false,
    register: "formal",
    detailLevel: "detailed",
  });
});

it("NFR-7 identifies unsupported languages without enabling them", async () => {
  const model = createModelRouter(parseBrainConfig()).modelFor("classifier");
  const result = await detectCommunicationPreferences(
    "Necesito ayuda para completar este formulario. ¿Dónde debo poner mi nombre y mi dirección?",
    model,
  );
  expect(result.detectedLanguage).toBe("unsupported");
  expect(result.requestedLanguage).toBeNull();
});

it("FR-L1–L3 persist spoken preferences and stream English captions and speech through a real turn", async () => {
  const database = await isolatedDatabase();
  try {
    const session = await identity(database.db, "L1");
    const message = userMessage();
    message.parts[0] = {
      type: "text",
      text: "Please answer in English using simple language. Address me informally and keep your answers brief. In one sentence, confirm you can help with administrative paperwork. Do not use tools.",
    };
    const response = await handleTurn({ ...turn, inputKind: "transcript" }, message, session, {
      db: database.db,
      config: parseBrainConfig(),
    });
    const parts = await chunks(response);
    expect(parts.some((part) => part.type === "error")).toBe(false);
    const answer = parts
      .flatMap((part) => (part.type === "text-delta" ? [part.delta] : []))
      .join("");
    expect(answer).toMatch(
      /help.*(?:paperwork|administrative)|(?:paperwork|administrative).*help/i,
    );
    const speech = parts.flatMap((part) =>
      part.type === "data-speech-segment" ? [part.data] : [],
    );
    expect(speech.length).toBeGreaterThan(0);
    expect(speech).toEqual(expect.arrayContaining([expect.objectContaining({ language: "en" })]));
    expect(await readProfileSettings(database.db, session.userId)).toEqual({
      language: "en",
      simpleLanguage: true,
      register: "informal",
      detailLevel: "brief",
    });
  } finally {
    await database.cleanup();
  }
});
