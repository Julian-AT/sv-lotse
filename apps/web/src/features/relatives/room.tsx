"use client";
import {
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { relativeRequest, tokenResponseSchema } from "./api.ts";
import { CURSOR_KEYBOARD_STEP, CURSOR_SEND_INTERVAL_MS, CURSOR_TOPIC } from "./config.ts";
import type { RelativesCopy } from "./copy.ts";
import { type PointerMessage, readPointerMessage, videoPoint } from "./messages.ts";
import { HelperPointer, updatePointer, useHelperPointer } from "./pointer.tsx";
import styles from "./relatives.module.css";

export function RelativeRoom({
  id,
  participantRole,
  copy,
}: {
  id: string;
  participantRole: "subject" | "helper";
  copy: RelativesCopy;
}): ReactElement {
  const room = useRef<Room | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [microphone, setMicrophone] = useState(false);
  const [hasScreen, setHasScreen] = useState(false);
  const [pointer, setPointer] = useHelperPointer();
  const lastSent = useRef(0);
  const position = useRef({ x: 0.5, y: 0.5 });
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
      const current = room.current;
      room.current = null;
      void current?.disconnect();
    },
    [],
  );

  async function connect(): Promise<void> {
    setBusy(true);
    setError(false);
    const attempt = ++generation.current;
    let current: Room | undefined;
    try {
      const credentials = await relativeRequest("/api/relatives/token", tokenResponseSchema, {
        id,
      });
      if (attempt !== generation.current) return;
      current = new Room();
      room.current = current;
      const activeRoom = current;
      activeRoom.on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          if (participant.identity !== credentials.peerIdentity) return;
          if (
            track.kind === Track.Kind.Video &&
            publication.source === Track.Source.ScreenShare &&
            video.current
          ) {
            track.attach(video.current);
            setHasScreen(true);
          } else if (track.kind === Track.Kind.Audio && audio.current)
            audio.current.append(track.attach());
        },
      );
      activeRoom.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const element of track.detach()) if (element.tagName === "AUDIO") element.remove();
        if (track.kind === Track.Kind.Video) setHasScreen(false);
      });
      activeRoom.on(RoomEvent.DataReceived, (bytes, participant, _kind, topic) => {
        if (
          participantRole !== "subject" ||
          topic !== CURSOR_TOPIC ||
          participant?.identity !== credentials.peerIdentity
        )
          return;
        const message = readPointerMessage(bytes);
        if (message) setPointer((previous) => updatePointer(previous, message));
      });
      activeRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.source === Track.Source.ScreenShare) {
          setSharing(false);
          setPointer({ cursor: null, marks: [] });
        }
      });
      activeRoom.on(RoomEvent.ParticipantDisconnected, () =>
        setPointer({ cursor: null, marks: [] }),
      );
      activeRoom.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setSharing(false);
        setMicrophone(false);
      });
      await activeRoom.connect(credentials.url, credentials.token);
      if (attempt !== generation.current) {
        await activeRoom.disconnect();
        return;
      }
      await activeRoom.startAudio();
      setConnected(true);
    } catch {
      await current?.disconnect();
      if (attempt === generation.current) {
        setError(true);
        room.current = null;
      }
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }

  async function toggleMedia(kind: "screen" | "microphone"): Promise<void> {
    const current = room.current;
    if (!current) return;
    setBusy(true);
    setError(false);
    try {
      if (kind === "screen") {
        await current.localParticipant.setScreenShareEnabled(!sharing, {
          audio: true,
        });
        setSharing(current.localParticipant.isScreenShareEnabled);
        if (sharing) setPointer({ cursor: null, marks: [] });
      } else {
        await current.localParticipant.setMicrophoneEnabled(!microphone);
        setMicrophone(current.localParticipant.isMicrophoneEnabled);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function send(type: PointerMessage["type"], point = position.current): void {
    if (!connected || participantRole !== "helper") return;
    position.current = point;
    if (type === "pointer" && performance.now() - lastSent.current < CURSOR_SEND_INTERVAL_MS)
      return;
    lastSent.current = performance.now();
    const bytes = new TextEncoder().encode(JSON.stringify({ type, ...point }));
    void room.current?.localParticipant
      .publishData(bytes, { topic: CURSOR_TOPIC, reliable: type !== "pointer" })
      .catch(() => setError(true));
  }
  function move(event: PointerEvent<HTMLButtonElement>): void {
    const element = video.current;
    if (!element || !hasScreen) return;
    const point = videoPoint(event.clientX, event.clientY, element.getBoundingClientRect(), {
      width: element.videoWidth,
      height: element.videoHeight,
    });
    if (point) send("pointer", point);
    else send("leave");
  }
  function key(event: KeyboardEvent<HTMLButtonElement>): void {
    const directions: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    send("pointer", {
      x: Math.max(0, Math.min(1, position.current.x + direction[0] * CURSOR_KEYBOARD_STEP)),
      y: Math.max(0, Math.min(1, position.current.y + direction[1] * CURSOR_KEYBOARD_STEP)),
    });
  }
  return (
    <div className={styles.room}>
      {!connected ? (
        <button type="button" disabled={busy} onClick={() => void connect()}>
          {participantRole === "subject" ? copy.connect : copy.helperConnect}
        </button>
      ) : (
        <div className={styles.controls}>
          <span className={styles.active} role="status">
            {copy.active}
          </span>
          <button type="button" disabled={busy} onClick={() => void toggleMedia("microphone")}>
            {microphone ? copy.mute : copy.microphone}
          </button>
          {participantRole === "subject" ? (
            <button type="button" disabled={busy} onClick={() => void toggleMedia("screen")}>
              {sharing ? copy.pause : copy.share}
            </button>
          ) : null}
        </div>
      )}
      {participantRole === "subject" ? (
        <p className={styles.note}>{copy.shareHelp}</p>
      ) : (
        <>
          <div className={styles.screen}>
            <video
              className={styles.video}
              ref={video}
              autoPlay
              playsInline
              muted
              aria-label={copy.screen}
            />
            {!hasScreen ? <p role="status">{copy.waitingScreen}</p> : null}
            <button
              type="button"
              className={styles.pointerSurface}
              aria-label={copy.pointerHelp}
              disabled={!hasScreen || !connected}
              onPointerMove={move}
              onPointerDown={move}
              onPointerLeave={() => send("leave")}
              onClick={() => send("mark")}
              onKeyDown={key}
            />
          </div>
          <div className={styles.controls}>
            <button type="button" disabled={!connected || !hasScreen} onClick={() => send("mark")}>
              {copy.annotate}
            </button>
            <button type="button" disabled={!connected} onClick={() => send("clear")}>
              {copy.clear}
            </button>
          </div>
          <p className={styles.note}>{copy.pointerHelp}</p>
        </>
      )}
      <div ref={audio} className={styles.audio} />
      {participantRole === "subject" && sharing ? (
        <HelperPointer state={pointer} copy={copy} />
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {copy.mediaError}
        </p>
      ) : null}
    </div>
  );
}
