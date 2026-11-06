import { DEFAULT_PREFERENCES } from "@lotse/brain/preferences/schema";
import {
  type Action,
  type ActionResult,
  ActionSchema,
  type BridgeToNative,
  BridgeToNativeSchema,
  BridgeToWorkspaceSchema,
  CaseEventSchema,
  PROTOCOL_VERSION,
  type SpeechSegment,
  SpeechSegmentSchema,
} from "@lotse/protocol";
import { z } from "zod";
import { WORKSPACE_CONFIG } from "../conversation/config.ts";
import { stopFormFilling } from "../features/form-viewer/config.ts";
import {
  applySpeechPreferences,
  type SpeechPreferences,
} from "../features/settings/speech-preferences.ts";
import { GUIDANCE_TRANSCRIPT_EVENT } from "./config.ts";
import { SentenceActions } from "./sentence-actions.ts";

interface NativeHandler {
  postMessage(message: BridgeToNative): Promise<unknown>;
}

type BridgeWindow = Window & {
  webkit?: { messageHandlers?: { lotse?: NativeHandler } };
  __lotse?: { receive: (message: unknown) => void };
};

const partSchema = z.object({ type: z.string(), data: z.unknown() });

export class GuidanceRuntime {
  private actionResults = new Map<string, ActionResult>();
  private readonly actions: SentenceActions;
  private segments = new Map<number, SpeechSegment>();
  private turnId: string | undefined;
  private generation = 0;
  private native = false;
  /** Typed turns stay silent: captions and sentence actions still follow, nothing is read aloud. */
  private spoken = true;
  private interrupted = false;
  private activeIndex = 0;
  private utterances = new Set<SpeechSynthesisUtterance>();
  speechPreferences: SpeechPreferences = DEFAULT_PREFERENCES;
  onCaption: (text: string) => void = () => {};
  onError: () => void = () => {};

  constructor(private readonly execute: (action: Action) => void) {
    this.actions = new SentenceActions(execute);
  }

  connect(): () => void {
    const host = window as BridgeWindow;
    const previousReceiver = host.__lotse;
    this.interrupted = false;
    const receive = (message: unknown): void => {
      const parsed = BridgeToWorkspaceSchema.safeParse(message);
      if (!parsed.success) return;
      const envelope = parsed.data;
      if (envelope.type === "BridgeHello") this.native = true;
      if (envelope.type === "SpeechControl") {
        if (envelope.payload.stop) this.stop(false);
        else if (envelope.payload.state === "speaking") {
          const segment = this.segments.get(envelope.payload.segmentIndex);
          if (segment) this.started(segment);
        }
      }
      if (envelope.type === "ActionResult") this.recordResult(envelope.payload);
      if (
        envelope.type === "Transcript" &&
        window.location?.pathname !== WORKSPACE_CONFIG.workspacePath
      ) {
        window.dispatchEvent(
          new CustomEvent(GUIDANCE_TRANSCRIPT_EVENT, { detail: envelope.payload }),
        );
      }
      previousReceiver?.receive(message);
    };
    host.__lotse = { receive };
    return () => {
      this.stop();
      if (host.__lotse?.receive === receive) {
        if (previousReceiver) host.__lotse = previousReceiver;
        else delete host.__lotse;
      }
    };
  }

  /** Pass each useChat onData part, or a part read from consumeGuidanceResponse, here. */
  ingest(raw: unknown): void {
    const parsed = partSchema.safeParse(raw);
    if (!parsed.success || this.interrupted) return;
    if (parsed.data.type === "data-action") {
      const action = ActionSchema.parse(parsed.data.data);
      if (this.native && action.target.kind === "ax")
        void this.send("Action", action).catch(() => this.onError());
      else this.actions.add(action);
    }
    if (parsed.data.type === "data-speech-segment")
      this.speak(SpeechSegmentSchema.parse(parsed.data.data));
    if (parsed.data.type === "data-case-event") {
      const event = CaseEventSchema.safeParse(parsed.data.data);
      if (event.success && event.data.kind === "step_completed") this.clear();
    }
  }

  recordResult(result: ActionResult): void {
    if (!this.actionResults.get(result.actionId)?.success)
      this.actionResults.set(result.actionId, result);
  }

  takeActionResults(): ActionResult[] {
    const results = [...this.actionResults.values()];
    this.actionResults.clear();
    return results;
  }

  beginTurn(spoken?: boolean): void {
    if (spoken !== undefined) this.spoken = spoken;
    this.stop();
    this.turnId = undefined;
    this.interrupted = false;
  }

  stop(notifyNative = true): void {
    this.interrupted = true;
    if (typeof window.dispatchEvent === "function") stopFormFilling();
    this.generation++;
    window.speechSynthesis?.cancel();
    this.utterances.clear();
    this.actions.reset();
    this.segments.clear();
    if (this.native && notifyNative) {
      void this.send("SpeechControl", { stop: true, state: "idle", segmentIndex: 0 }).catch(() =>
        this.onError(),
      );
    }
  }

  private clear(): void {
    const action: Action = {
      id: crypto.randomUUID(),
      kind: "clear",
      target: { kind: "ui", elementId: "guidance" },
      payload: {},
      sentenceIndex: this.activeIndex,
    };
    this.execute(action);
  }

  private speak(segment: SpeechSegment): void {
    // New turn actions can arrive before its first segment. beginTurn resets the old queue.
    if (this.turnId && this.turnId !== segment.turnId) this.beginTurn();
    this.turnId = segment.turnId;
    if (this.segments.has(segment.index)) return;
    this.segments.set(segment.index, segment);
    if (!this.spoken) {
      this.started(segment);
      return;
    }
    if (this.native) {
      void this.send("SpeechSegment", segment).catch(() => this.onError());
      return;
    }
    if (!window.speechSynthesis) {
      this.onError();
      return;
    }
    const generation = this.generation;
    const utterance = new SpeechSynthesisUtterance(segment.text);
    utterance.lang = segment.language;
    applySpeechPreferences(
      utterance,
      this.speechPreferences,
      window.speechSynthesis.getVoices?.() ?? [],
    );
    utterance.onstart = () => {
      if (generation === this.generation) this.started(segment);
    };
    utterance.onend = () => this.utterances.delete(utterance);
    utterance.onerror = () => {
      this.utterances.delete(utterance);
      if (generation === this.generation) this.onError();
    };
    this.utterances.add(utterance);
    window.speechSynthesis.speak(utterance);
  }

  private started(segment: SpeechSegment): void {
    this.activeIndex = segment.index;
    this.onCaption(segment.text);
    this.actions.start(segment);
  }

  private async send(type: string, payload: unknown): Promise<void> {
    const message = BridgeToNativeSchema.parse({
      v: PROTOCOL_VERSION,
      id: crypto.randomUUID(),
      type,
      payload,
    });
    const handler = (window as BridgeWindow).webkit?.messageHandlers?.lotse;
    if (!handler) throw new Error("BRIDGE_UNAVAILABLE");
    await handler.postMessage(message);
  }
}
