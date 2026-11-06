"use client";

import type { Action, ActionResult } from "@lotse/protocol";
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type ClientRuntime, createClientRuntime } from "../conversation/client-tools.ts";
import { stopFormFilling } from "../features/form-viewer/config.ts";
import { useSpeechPreferences } from "../features/settings/speech-preferences.ts";
import { viewerCopy } from "../features/viewer/copy.ts";
import { type DocumentSelection, DocumentViewer } from "../features/viewer/document-viewer.tsx";
import { GUIDANCE_PART_EVENT } from "./config.ts";
import { GuidanceRuntime } from "./runtime.ts";

interface GuidanceContext {
  ingest: (part: unknown) => void;
  /** `spoken` is false for typed turns: the answer is not read aloud. */
  beginTurn: (spoken?: boolean) => void;
  stop: () => void;
  highlightDocument: (action: Action) => void;
  openDocument: (selection: DocumentSelection) => void;
  takeActionResults: () => ActionResult[];
  setCaseId: (id: string) => void;
}

const Context = createContext<GuidanceContext | null>(null);

export function useGuidance(): GuidanceContext {
  const context = useContext(Context);
  if (!context) throw new Error("GUIDANCE_PROVIDER_REQUIRED");
  return context;
}

export function GuidanceProvider({
  children,
  language,
}: {
  children: ReactNode;
  language: "de" | "en";
}): JSX.Element {
  const speechPreferences = useSpeechPreferences();
  const [selection, setSelection] = useState<DocumentSelection | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState(false);
  const caseId = useRef("");
  const runtime = useRef<GuidanceRuntime | null>(null);
  const client = useRef<ClientRuntime | null>(null);
  function highlightDocument(action: Action): void {
    if (action.kind === "clear") {
      setSelection((current) => (current ? { ...current, quote: "" } : null));
      client.current?.clear();
      return;
    }
    if (
      action.kind === "highlight" &&
      action.target.kind === "text" &&
      action.target.documentId &&
      caseId.current
    ) {
      const target = action.target;
      setSelection({
        actionId: action.id,
        documentId: target.documentId ?? "",
        caseId: caseId.current,
        ...(target.page ? { page: target.page } : {}),
        quote: target.quote,
      });
    }
  }
  if (!client.current)
    client.current = createClientRuntime({ openDocumentHighlight: highlightDocument });
  if (!runtime.current)
    runtime.current = new GuidanceRuntime((action) => {
      if (action.kind === "clear") highlightDocument(action);
      else
        void client.current
          ?.action(action)
          .then((result) => {
            if (result) runtime.current?.recordResult(result);
          })
          .catch(() => setError(true));
    });
  const player = runtime.current;
  player.speechPreferences = speechPreferences;
  useEffect(() => {
    player.onCaption = setCaption;
    player.onError = () => setError(true);
    const disconnect = player.connect();
    const onPart = (event: Event): void => {
      if (event instanceof CustomEvent) player.ingest(event.detail);
    };
    window.addEventListener(GUIDANCE_PART_EVENT, onPart);
    return () => {
      disconnect();
      client.current?.dispose();
      window.removeEventListener(GUIDANCE_PART_EVENT, onPart);
    };
  }, [player]);
  const reportResult = useCallback(
    (actionId: string, success: boolean): void => {
      player.recordResult({
        actionId,
        resolvedBy: "ui",
        success,
        confidence: success ? 1 : 0,
        ...(success ? {} : { failureReason: "TEXT_NOT_FOUND" }),
      });
    },
    [player],
  );
  const context: GuidanceContext = {
    takeActionResults: () => player.takeActionResults(),
    ingest: (part) => player.ingest(part),
    beginTurn: (spoken) => {
      setError(false);
      player.beginTurn(spoken);
    },
    stop: () => {
      player.stop();
      stopFormFilling();
    },
    highlightDocument,
    setCaseId: (id) => {
      caseId.current = id;
    },
    openDocument: (next) => {
      caseId.current = next.caseId;
      setSelection(next);
    },
  };
  return (
    <Context.Provider value={context}>
      {children}
      {caption && (
        <div>
          <p aria-live="polite">{caption}</p>
          <button
            type="button"
            onClick={() => {
              player.stop();
              stopFormFilling();
            }}
          >
            {viewerCopy[language].stop}
          </button>
        </div>
      )}
      {error && <p role="status">{viewerCopy[language].speechError}</p>}
      {selection && (
        <DocumentViewer
          selection={selection}
          onResolved={reportResult}
          language={language}
          onClose={() => setSelection(null)}
        />
      )}
    </Context.Provider>
  );
}
