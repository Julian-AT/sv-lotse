"use client";

import { useRouter } from "next/navigation";
import { type JSX, useState } from "react";
import { SESSION_RESET_EVENT, SETTINGS_CONFIG } from "@/config.ts";
import type { PanelsCopy } from "./panels-copy.ts";
import styles from "./settings.module.css";

export function PrivacyActions({
  copy,
  resetCopy,
  onStatus,
  onBusy,
}: {
  copy: PanelsCopy;
  resetCopy: {
    reset: string;
    resetting: string;
    resetHelp: string;
    resetDone: string;
    resetError: string;
  };
  onStatus: (status: string) => void;
  onBusy: (busy: boolean) => void;
}): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<"export" | "delete" | "reset">();
  const [confirming, setConfirming] = useState(false);
  async function act(action: "export" | "delete" | "reset"): Promise<void> {
    setPending(action);
    onBusy(true);
    onStatus("");
    try {
      const endpoint =
        action === "export"
          ? SETTINGS_CONFIG.exportUrl
          : action === "delete"
            ? SETTINGS_CONFIG.deleteUrl
            : SETTINGS_CONFIG.sessionUrl;
      const response = await fetch(endpoint, {
        method: action === "export" ? "POST" : "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("PRIVACY_ACTION_FAILED");
      if (action === "export") {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = SETTINGS_CONFIG.downloadFilename;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        onStatus(copy.exported);
      } else {
        setConfirming(false);
        onStatus(action === "delete" ? copy.deleted : resetCopy.resetDone);
        window.dispatchEvent(new Event(SESSION_RESET_EVENT));
        router.refresh();
      }
    } catch {
      onStatus(action === "reset" ? resetCopy.resetError : copy.actionError);
    } finally {
      setPending(undefined);
      onBusy(false);
    }
  }
  return (
    <div className={styles.privacyActions}>
      <button
        type="button"
        className={styles.secondary}
        disabled={Boolean(pending)}
        onClick={() => void act("export")}
      >
        {pending === "export" ? copy.exporting : copy.export}
      </button>
      <div className={styles.actionRow}>
        <div>
          <strong>{resetCopy.reset}</strong>
          <p>{resetCopy.resetHelp}</p>
        </div>
        <button
          type="button"
          className={styles.secondary}
          disabled={Boolean(pending)}
          onClick={() => void act("reset")}
        >
          {pending === "reset" ? resetCopy.resetting : resetCopy.reset}
        </button>
      </div>
      <div className={styles.dangerZone}>
        <p>{copy.deleteHelp}</p>
        {confirming ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.danger}
              disabled={Boolean(pending)}
              onClick={() => void act("delete")}
            >
              {pending === "delete" ? copy.deleting : copy.confirmDelete}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={Boolean(pending)}
              onClick={() => setConfirming(false)}
            >
              {copy.cancel}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.danger}
            disabled={Boolean(pending)}
            onClick={() => setConfirming(true)}
          >
            {copy.delete}
          </button>
        )}
      </div>
    </div>
  );
}
