"use client";

import type { LotseMessage } from "@lotse/brain";
import { Button, Field, Heading, Inline, Select } from "@lotse/ui";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { hasNativeBridge, mountWorkspaceBridge } from "../bridge/index.ts";
import { SESSION_RESET_EVENT } from "../config.ts";
import { useI18n } from "../i18n/provider.tsx";
import { workspaceFetch } from "./api.ts";
import { WORKSPACE_CONFIG } from "./config.ts";
import { Conversation } from "./conversation.tsx";
import { selectInitialCase } from "./initial-case.ts";
import { loadConversation } from "./load.ts";
import { type CaseSummary, CaseSummarySchema, CasesResponseSchema } from "./schemas.ts";
import styles from "./workspace.module.css";

type ActiveCase = { summary: CaseSummary; messages: LotseMessage[] };

export function Workspace(): JSX.Element {
  const { t } = useI18n();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [active, setActive] = useState<ActiveCase>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const unmount = mountWorkspaceBridge();
    if (hasNativeBridge()) document.documentElement.dataset.nativeWorkspace = "true";
    return () => {
      delete document.documentElement.dataset.nativeWorkspace;
      unmount();
    };
  }, []);
  const select = useCallback(async (summary: CaseSummary): Promise<void> => {
    const version = ++generation.current;
    setLoading(true);
    setFailed(false);
    setActive(undefined);
    try {
      const snapshot = await loadConversation(summary.id, new AbortController().signal);
      if (version === generation.current) setActive({ summary, messages: snapshot.messages });
    } catch {
      if (version === generation.current) setFailed(true);
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const reset = (): void => {
      const current = activeRef.current;
      if (current) void select(current.summary);
    };
    window.addEventListener(SESSION_RESET_EVENT, reset);
    return () => window.removeEventListener(SESSION_RESET_EVENT, reset);
  }, [select]);
  const refresh = async (): Promise<CaseSummary[]> => {
    const result = CasesResponseSchema.parse(
      await workspaceFetch(WORKSPACE_CONFIG.caseListApi),
    ).cases;
    setCases(result);
    return result;
  };
  useEffect(() => {
    let mounted = true;
    void workspaceFetch(WORKSPACE_CONFIG.caseListApi)
      .then(async (response) => {
        if (!mounted) return;
        const result = CasesResponseSchema.parse(response).cases;
        setCases(result);
        const first = selectInitialCase(result, window.location.search);
        if (first) await select(first);
        else if (hasNativeBridge()) {
          const created = z
            .strictObject({ case: CaseSummarySchema })
            .parse(await workspaceFetch(WORKSPACE_CONFIG.casesApi, { method: "POST" }));
          if (mounted) {
            setCases([created.case]);
            await select(created.case);
          }
        } else setLoading(false);
      })
      .catch(() => {
        if (mounted) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
      generation.current++;
    };
  }, [select]);
  const create = async (): Promise<void> => {
    setLoading(true);
    setFailed(false);
    try {
      const response = z
        .strictObject({ case: CaseSummarySchema })
        .parse(await workspaceFetch(WORKSPACE_CONFIG.casesApi, { method: "POST" }));
      setCases((current) => [response.case, ...current]);
      await select(response.case);
    } catch {
      setFailed(true);
      setLoading(false);
    }
  };
  return (
    <div className={styles.workspace}>
      <div className={styles.caseControls}>
        <Heading level={1}>{t("workspace.cases")}</Heading>
        <Inline>
          <Field label={t("workspace.cases")}>
            <Select
              value={active?.summary.id ?? ""}
              disabled={loading}
              onChange={(event) => {
                const selected = cases.find((item) => item.id === event.target.value);
                if (selected) void select(selected);
              }}
            >
              <option value="" disabled>
                {t("workspace.cases")}
              </option>
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.confirmedGoal || t("workspace.untitled")}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={loading} onClick={() => void create()}>
            {t("workspace.newCase")}
          </Button>
        </Inline>
      </div>
      {loading && <p role="status">{t("workspace.ui.assistant")} …</p>}
      {failed && (
        <div role="alert">
          <p>{t("workspace.loadError")}</p>
          <Button
            onClick={() => {
              setLoading(true);
              setFailed(false);
              void refresh()
                .then((items) => (items[0] ? select(items[0]) : setLoading(false)))
                .catch(() => {
                  setFailed(true);
                  setLoading(false);
                });
            }}
          >
            {t("workspace.retry")}
          </Button>
        </div>
      )}
      {!loading && !failed && !active && <p>{t("workspace.empty")}</p>}
      {active && (
        <Conversation
          key={active.summary.id}
          selectedCase={cases.find((entry) => entry.id === active.summary.id) ?? active.summary}
          initialMessages={active.messages}
          onSettled={() => {
            void refresh().catch(() => setFailed(true));
          }}
        />
      )}
    </div>
  );
}
