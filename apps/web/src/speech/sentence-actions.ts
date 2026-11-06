import type { Action, SpeechSegment } from "@lotse/protocol";

/** A stream arrival never starts a step. Only an audio playback callback does. */
export class SentenceActions {
  private actions = new Map<string, Action>();
  private fired = new Set<string>();
  private current: SpeechSegment | undefined;

  constructor(private readonly execute: (action: Action) => void) {}

  add(action: Action): void {
    this.actions.set(action.id, action);
    if (this.current && this.belongsTo(action, this.current)) this.fire(action);
  }

  start(segment: SpeechSegment): void {
    this.current = segment;
    for (const action of this.actions.values()) {
      if (this.belongsTo(action, segment)) this.fire(action);
    }
  }

  reset(): void {
    this.actions.clear();
    this.fired.clear();
    this.current = undefined;
  }

  private belongsTo(action: Action, segment: SpeechSegment): boolean {
    return action.sentenceIndex === segment.index || segment.actionIds.includes(action.id);
  }

  private fire(action: Action): void {
    if (this.fired.has(action.id)) return;
    this.fired.add(action.id);
    this.execute(action);
  }
}
