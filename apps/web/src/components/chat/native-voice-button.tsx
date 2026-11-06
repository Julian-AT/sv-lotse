"use client";

import { MicIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider.tsx";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

type VoiceHandler = { postMessage: (command: "toggle" | "stop" | "state") => Promise<unknown> };
export const NATIVE_VOICE_STATE_EVENT = "lotse:voice-state";

function nativeVoice(): VoiceHandler | undefined {
  if (typeof window === "undefined") return undefined;
  const handlers = (window as { webkit?: { messageHandlers?: { lotseVoice?: VoiceHandler } } })
    .webkit?.messageHandlers;
  return handlers?.lotseVoice;
}

export function listeningFrom(reply: unknown): boolean | undefined {
  if (typeof reply !== "object" || reply === null || !("listening" in reply)) return undefined;
  return reply.listening === true;
}

/**
 * Inside the Mac app the mic button drives the native capture (the same path as holding ⌥⌘:
 * Scribe, Clicky's bubble, one final transcript into this conversation). The page records nothing
 * itself. Outside the app there is no button.
 */
export function NativeVoiceButton({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const handler = nativeVoice();
    setAvailable(Boolean(handler));
    if (!handler) return;
    const update = (event: Event): void => {
      if (event instanceof CustomEvent) setListening(listeningFrom(event.detail) ?? false);
    };
    window.addEventListener(NATIVE_VOICE_STATE_EVENT, update);
    void handler
      .postMessage("state")
      .then((reply) => setListening(listeningFrom(reply) ?? false))
      .catch(() => setAvailable(false));
    return () => window.removeEventListener(NATIVE_VOICE_STATE_EVENT, update);
  }, []);

  if (!available) return null;
  const label = t(listening ? "workspace.voiceSend" : "workspace.voiceStart");
  return (
    <Button
      aria-label={label}
      aria-pressed={listening}
      className={cn(
        "h-7 w-7 rounded-lg border border-border/40 p-1 text-foreground transition-colors hover:border-border",
        listening && "border-transparent bg-red-500 text-white hover:bg-red-500/90",
      )}
      data-testid="voice-button"
      disabled={disabled && !listening}
      onClick={(event) => {
        event.preventDefault();
        void nativeVoice()
          ?.postMessage("toggle")
          .then((reply) => setListening(listeningFrom(reply) ?? false))
          .catch(() => setAvailable(false));
      }}
      title={label}
      variant="ghost"
    >
      <MicIcon className={cn("size-3.5", listening && "animate-pulse")} />
    </Button>
  );
}
