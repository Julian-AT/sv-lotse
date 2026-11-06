// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WorkspaceAppointments } from "../src/features/workspace/appointments.tsx";
import { workspaceCopy } from "../src/features/workspace/copy.ts";
import type { RecognitionCallbacks } from "../src/voice/recognition.ts";
import type { SpeechCallbacks } from "../src/voice/synthesis.ts";

const voice = vi.hoisted(() => ({
  enqueue: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
  unlock: vi.fn(),
  start: vi.fn(),
  release: vi.fn(),
  cancel: vi.fn(),
  speech: undefined as SpeechCallbacks | undefined,
  recognition: undefined as RecognitionCallbacks | undefined,
}));
vi.mock("../src/voice/synthesis.ts", () => ({
  BrowserSpeech: class {
    constructor(callbacks: SpeechCallbacks) {
      voice.speech = callbacks;
    }
    enqueue = voice.enqueue;
    stop = voice.stop;
    dispose = voice.dispose;
    unlock = voice.unlock;
  },
}));
vi.mock("../src/voice/recognition.ts", () => ({
  BrowserRecognition: class {
    constructor(callbacks: RecognitionCallbacks) {
      voice.recognition = callbacks;
    }
    start = voice.start;
    release = voice.release;
    cancel = voice.cancel;
  },
}));

// Synthetic administrative contact and script isolate the interaction; the real
// script and catalog are covered in brain and knowledge tests.
const facility = {
  id: "test-contact",
  title: "Test contact",
  type: "Test category",
  region: "Test city",
  address: "Test street",
  location: null,
  openingHours: null,
  phone: null,
  email: null,
  url: null,
  bookingUrls: [],
  accessibility: null,
  services: [],
  sources: [],
  asOf: "2026-11-06",
  distanceKm: null,
};

const script = {
  notice: "Practice only",
  callSheet: "Administrative call sheet",
  script: [
    { role: "office", text: "Office opening" },
    { role: "caller", text: "Caller suggestion" },
    { role: "caller", text: "Another caller suggestion" },
    { role: "office", text: "Office closing" },
    { role: "caller", text: "Caller closing" },
  ],
};

const copy = workspaceCopy.de;
const fetcher = vi.fn();
function mount(): ReturnType<typeof render> {
  return render(
    createElement(WorkspaceAppointments, {
      facilities: [facility],
      caseId: "00000000-0000-4000-8000-000000000001",
      benefitId: null,
      initialFacilityId: facility.id,
      language: "de",
      copy,
    }),
  );
}

async function begin(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: copy.rehearse }));
  await waitFor(() => expect(voice.enqueue).toHaveBeenCalledTimes(1));
}

function finishLine(): void {
  act(() => voice.speech?.complete?.());
}

function submit(text: string): void {
  fireEvent.change(screen.getByLabelText(copy.rehearsalReply), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: copy.rehearsalSend }));
}
beforeEach(() => {
  vi.clearAllMocks();
  fetcher.mockResolvedValue(Response.json(script));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("FR-O4 plays only office lines, shows captions and waits for a typed reply between them", async () => {
  mount();
  await begin();
  expect(fetcher).toHaveBeenCalledWith(
    "/api/appointments/rehearse",
    expect.objectContaining({ method: "POST" }),
  );
  expect(voice.enqueue).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: "Office opening", language: "de-AT" }),
  );
  expect(screen.getByText("Stelle: Office opening").getAttribute("role")).toBe("status");
  expect((screen.getByLabelText(copy.rehearsalReply) as HTMLTextAreaElement).disabled).toBe(true);
  finishLine();
  expect(voice.enqueue).toHaveBeenCalledTimes(1);
  submit("My administrative question");
  await waitFor(() => expect(voice.enqueue).toHaveBeenCalledTimes(2));
  expect(voice.enqueue).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: "Office closing" }),
  );
  expect(screen.getByText("Sie: My administrative question")).toBeTruthy();
  finishLine();
  submit("Thank you");
  expect(screen.getByText(copy.rehearsalDone)).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("FR-O4 accepts spoken replies for review and retains typing after microphone failure", async () => {
  mount();
  await begin();
  finishLine();
  fireEvent.click(screen.getByRole("button", { name: copy.rehearsalSpeak }));
  expect(voice.start).toHaveBeenCalledWith("de");
  act(() => voice.recognition?.state("listening"));
  fireEvent.click(screen.getByRole("button", { name: copy.rehearsalFinishSpeaking }));
  expect(voice.release).toHaveBeenCalledTimes(1);
  act(() => {
    voice.recognition?.state("idle");
    voice.recognition?.final("Spoken reply");
  });
  expect((screen.getByLabelText(copy.rehearsalReply) as HTMLTextAreaElement).value).toBe(
    "Spoken reply",
  );
  expect(voice.enqueue).toHaveBeenCalledTimes(1);
  act(() => voice.recognition?.state("error"));
  expect(screen.getByText(copy.rehearsalVoiceError)).toBeTruthy();
  submit("Reviewed reply");
  await waitFor(() => expect(voice.enqueue).toHaveBeenCalledTimes(2));
});

test("FR-O4 stops audio and microphone on cancellation and facility changes", async () => {
  const view = mount();
  await begin();
  act(() => voice.speech?.fallback());
  expect(screen.getByText(copy.rehearsalVoiceFallback)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: copy.rehearsalSkipAudio }));
  expect(voice.stop).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: copy.rehearsalStop }));
  expect(voice.cancel).toHaveBeenCalled();
  expect(screen.queryByLabelText(copy.rehearsalReply)).toBeNull();
  fireEvent.change(screen.getByLabelText(copy.selectFacility), { target: { value: "" } });
  expect(voice.dispose).toHaveBeenCalled();
  view.unmount();
});

test("FR-O4 reports invalid rehearsal output and does not start speech", async () => {
  fetcher.mockResolvedValue(Response.json({ script: [] }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: copy.rehearse }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy.error));
  expect(voice.enqueue).not.toHaveBeenCalled();
});
