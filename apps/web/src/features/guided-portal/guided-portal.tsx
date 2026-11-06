"use client";

import {
  allowedPortalUrl,
  type PortalField,
  type PortalPage,
  type PortalReply,
} from "@lotse/guide/portal";
import { useEffect, useRef, useState } from "react";
import { portalBookmarklet } from "./bookmarklet.ts";
import { GUIDED_PORTAL_CONFIG } from "./config.ts";
import { guidedPortalCopy } from "./copy.ts";
import styles from "./portal.module.css";
import { connectPortalWindow, type PortalClient } from "./portal-client.ts";

type Status =
  | "idle"
  | "waiting"
  | "ready"
  | "captured"
  | "done"
  | "failed"
  | "blocked"
  | "closed"
  | "busy";
type Review = { url: string; fields: PortalField[] };
type Portal = { readonly origin: string; readonly purpose: string };

export function GuidedPortal({
  language,
  portals,
}: {
  language: "de" | "en";
  portals: readonly Portal[];
}) {
  const copy = guidedPortalCopy[language];
  const [url, setUrl] = useState(portals[0]?.origin ?? "");
  const [bookmarklet, setBookmarklet] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState<PortalPage>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review>();
  const client = useRef<PortalClient | undefined>(undefined);
  // React blocks javascript: href props. Set only our generated, origin-pinned bookmark via the DOM.
  const bookmark = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    bookmark.current?.setAttribute("href", bookmarklet);
  }, [bookmarklet]);
  useEffect(() => () => client.current?.dispose(), []);
  const busy = status === "busy";
  const fields =
    page?.handles.filter((handle) => handle.role === "textbox" || handle.role === "searchbox") ??
    [];

  function invalidate(): void {
    setPage(undefined);
    setValues({});
    setReview(undefined);
  }
  function receive(reply: PortalReply): void {
    if (reply.kind === "ready") {
      invalidate();
      setConnected(true);
      setStatus("ready");
    } else if (reply.kind === "closed") {
      setConnected(false);
      setStatus("closed");
      invalidate();
    } else if (reply.kind === "snapshot" && reply.page) {
      setPage(reply.page);
      setValues({});
      setReview(undefined);
      setStatus("captured");
    } else {
      setStatus(reply.success ? "done" : "failed");
      setReview(undefined);
    }
  }
  function open(): void {
    const allowed = allowedPortalUrl(
      url,
      portals.map((portal) => portal.origin),
    );
    if (!allowed) {
      setStatus("blocked");
      return;
    }
    client.current?.dispose();
    invalidate();
    setConnected(false);
    const popup = window.open(allowed, "_blank", GUIDED_PORTAL_CONFIG.windowFeatures);
    if (!popup) {
      setStatus("blocked");
      return;
    }
    const connection = {
      workspaceOrigin: location.origin,
      portalOrigin: new URL(allowed).origin,
      channel: crypto.randomUUID(),
      allowlist: portals.map((portal) => portal.origin),
    };
    client.current = connectPortalWindow(popup, connection, receive, () => {
      setConnected(false);
      setStatus("blocked");
      invalidate();
    });
    setBookmarklet(portalBookmarklet(connection));
    setStatus("waiting");
  }
  function prepareReview(): void {
    if (!page) return;
    const selected = fields.flatMap((field) => {
      const value = values[field.id];
      return value === undefined || value === ""
        ? []
        : [{ handle: field.id, label: field.label, value }];
    });
    if (selected.length) setReview({ url: page.url, fields: selected });
  }
  function fill(): void {
    if (!review || !connected || busy) return;
    const approved = review;
    setReview(undefined);
    setStatus("busy");
    client.current?.send({ kind: "fill", approved: true, ...approved });
  }
  function stop(): void {
    client.current?.send({ kind: "clear" });
    setReview(undefined);
    setStatus("failed");
  }
  function disconnect(): void {
    client.current?.dispose();
    client.current = undefined;
    setConnected(false);
    setBookmarklet("");
    setStatus("closed");
    invalidate();
  }
  return (
    <section className={styles.portal} aria-labelledby="portal-title">
      <h1 id="portal-title">{copy.title}</h1>
      <p>{copy.introduction}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          open();
        }}
      >
        <label htmlFor="portal-url">{copy.url}</label>
        <input
          id="portal-url"
          type="url"
          required
          list="portal-origins"
          value={url}
          disabled={busy}
          onChange={(event) => setUrl(event.target.value)}
        />
        <datalist id="portal-origins">
          {portals.map((portal) => (
            <option key={portal.origin} value={portal.origin}>
              {portal.purpose}
            </option>
          ))}
        </datalist>
        <button type="submit" disabled={busy}>
          {copy.open}
        </button>
      </form>
      {bookmarklet && (
        <div>
          <p>{copy.instructions}</p>
          <a href="#portal-title" ref={bookmark} className={styles.bookmark} draggable>
            {copy.bookmark}
          </a>
          <details>
            <summary>{copy.code}</summary>
            <p>{copy.codeHelp}</p>
            <textarea
              readOnly
              aria-label={copy.code}
              value={bookmarklet}
              onFocus={(event) => event.target.select()}
            />
          </details>
        </div>
      )}
      <p role="status" aria-live="polite">
        {copy[status]}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={!connected || busy}
          onClick={() => {
            invalidate();
            client.current?.send({ kind: "snapshot" });
          }}
        >
          {copy.snapshot}
        </button>
        <button type="button" disabled={!connected} onClick={stop}>
          {copy.stop}
        </button>
        <button type="button" disabled={!bookmarklet} onClick={disconnect}>
          {copy.disconnect}
        </button>
      </div>
      {page && (
        <fieldset disabled={busy || review !== undefined}>
          <legend>{new URL(page.url).origin}</legend>
          {fields.length === 0 && <p>{copy.noFields}</p>}
          {fields.map((field) => (
            <div key={field.id} className={styles.field}>
              <label htmlFor={`value-${field.id}`}>
                {field.label || field.id} — {copy.value}
              </label>
              <input
                id={`value-${field.id}`}
                value={values[field.id] ?? ""}
                autoComplete="off"
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, [field.id]: event.target.value }))
                }
              />
              <button
                type="button"
                onClick={() =>
                  client.current?.send({ kind: "point", url: page.url, handle: field.id })
                }
              >
                {copy.point}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={prepareReview}
            disabled={!fields.some((field) => Boolean(values[field.id]))}
          >
            {copy.review}
          </button>
        </fieldset>
      )}
      {review && (
        <section className={styles.review} aria-label={copy.review}>
          <h2>{copy.review}</h2>
          <p>{review.url}</p>
          <p>{copy.warning}</p>
          <dl>
            {review.fields.map((field) => (
              <div key={field.handle}>
                <dt>{field.label || field.handle}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
          <p>{copy.source}</p>
          <button type="button" onClick={fill}>
            {copy.approve}
          </button>
          <button type="button" onClick={() => setReview(undefined)}>
            {copy.cancel}
          </button>
        </section>
      )}
    </section>
  );
}
