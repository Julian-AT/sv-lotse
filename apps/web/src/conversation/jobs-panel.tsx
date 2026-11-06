"use client";

import type { JobProgress } from "@lotse/protocol";
import { type Dispatch, type ReactElement, type SetStateAction, useEffect, useState } from "react";
import { JOB_POLL_INTERVAL_MS } from "../config.ts";
import { continuityCopy } from "./copy.ts";
import { loadJobProgress } from "./load.ts";

export function JobsPanel({
  jobs,
  setJobs,
  language,
}: {
  jobs: JobProgress[];
  setJobs: Dispatch<SetStateAction<JobProgress[]>>;
  language: "de" | "en";
}): ReactElement | null {
  const [speak, setSpeak] = useState(true);
  const copy = continuityCopy[language];
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const pending = jobs.filter((job) => job.state === "pending" || job.state === "running");
    if (pending.length === 0) return;
    const poll = async () => {
      const updates = await Promise.allSettled(
        pending.map((job) => loadJobProgress(job.jobId, controller.signal)),
      );
      if (controller.signal.aborted) return;
      const progress = updates.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (progress.length > 0) {
        setJobs((previous) =>
          previous.map((job) => progress.find((update) => update.jobId === job.jobId) ?? job),
        );
        for (const job of progress.filter((job) => job.state === "completed")) {
          window.dispatchEvent(new CustomEvent("lotse:job-completed", { detail: job }));
          if (speak && "speechSynthesis" in window) {
            const notice = new SpeechSynthesisUtterance(job.message);
            notice.lang = language === "de" ? "de-AT" : "en";
            window.speechSynthesis.speak(notice);
          }
        }
      } else schedule();
    };
    const schedule = (): void => {
      timer = setTimeout(() => void poll(), JOB_POLL_INTERVAL_MS);
    };
    schedule();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobs, setJobs, speak, language]);
  if (jobs.length === 0) return null;
  return (
    <aside aria-label={copy.jobTitle}>
      <h2>{copy.jobTitle}</h2>
      <label>
        <input
          type="checkbox"
          checked={speak}
          onChange={(event) => setSpeak(event.target.checked)}
        />{" "}
        {copy.voice}
      </label>
      <ul aria-live="polite">
        {jobs.map((job) => (
          <li key={job.jobId}>
            <p>{job.message}</p>
            <progress value={job.progress} max={1} aria-label={job.message} />
          </li>
        ))}
      </ul>
    </aside>
  );
}
