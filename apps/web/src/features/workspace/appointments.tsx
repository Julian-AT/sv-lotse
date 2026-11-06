"use client";

import {
  type AppointmentPreparation,
  appointmentPreparationSchema,
  type WorkspaceFacility,
} from "@lotse/brain/workspace/schema";
import { type JSX, useState } from "react";
import { CallRehearsal } from "./call-rehearsal.tsx";
import {
  APPOINTMENT_CALENDAR_URL,
  APPOINTMENT_FILENAME,
  APPOINTMENT_PREPARE_URL,
} from "./config.ts";
import type { WorkspaceCopy, WorkspaceLanguage } from "./copy.ts";
import { FacilityContacts, FacilitySources } from "./facilities.tsx";
import styles from "./workspace.module.css";

function CopyButton({ value, copy }: { value: string; copy: WorkspaceCopy }): JSX.Element {
  const [status, setStatus] = useState("");
  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(copy.copied);
    } catch {
      setStatus(copy.copyError);
    }
  }
  return (
    <div className={styles.actions}>
      <button type="button" onClick={() => void copyText()}>
        {copy.copy}
      </button>
      <span role="status">{status}</span>
    </div>
  );
}

function CalendarHold({
  caseId,
  facilityId,
  language,
  copy,
}: {
  caseId: string;
  facilityId: string;
  language: WorkspaceLanguage;
  copy: WorkspaceCopy;
}): JSX.Element {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  async function download(): Promise<void> {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime()) ||
      endDate <= startDate
    ) {
      setStatus(copy.invalidTime);
      return;
    }
    setPending(true);
    try {
      const query = new URLSearchParams({
        caseId,
        facilityId,
        language,
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
      });
      const response = await fetch(`${APPOINTMENT_CALENDAR_URL}?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("CALENDAR_FAILED");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = APPOINTMENT_FILENAME;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(copy.downloaded);
    } catch {
      setStatus(copy.downloadError);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className={styles.card} aria-labelledby="calendar-hold">
      <h2 id="calendar-hold">{copy.hold}</h2>
      <p>{copy.calendarHelp}</p>
      <div className={styles.toolbar}>
        <div className={styles.field}>
          <label htmlFor="hold-start">{copy.start}</label>
          <input
            id="hold-start"
            type="datetime-local"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="hold-end">{copy.end}</label>
          <input
            id="hold-end"
            type="datetime-local"
            value={end}
            min={start || undefined}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={pending} onClick={() => void download()}>
          {copy.download}
        </button>
        <p role="status">{status}</p>
      </div>
    </section>
  );
}

function DraftEditor({
  preparation,
  copy,
}: {
  preparation: AppointmentPreparation;
  copy: WorkspaceCopy;
}): JSX.Element {
  const [email, setEmail] = useState(preparation.emailDraft);
  const [subject, setSubject] = useState(preparation.emailSubject);
  const [callSheet, setCallSheet] = useState(preparation.callSheet);
  return (
    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="call-sheet-title">
        <h2 id="call-sheet-title">{copy.callSheet}</h2>
        <div className={styles.field}>
          <label htmlFor="call-sheet">{copy.callSheet}</label>
          <textarea
            id="call-sheet"
            value={callSheet}
            onChange={(event) => setCallSheet(event.target.value)}
          />
        </div>
        <CopyButton value={callSheet} copy={copy} />
      </section>
      <section className={styles.card} aria-labelledby="email-draft-title">
        <h2 id="email-draft-title">{copy.emailDraft}</h2>
        <p>{copy.draftHelp}</p>
        <div className={styles.field}>
          <label htmlFor="email-subject">{copy.emailSubject}</label>
          <input
            id="email-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <label htmlFor="email-draft">{copy.emailDraft}</label>
          <textarea
            id="email-draft"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <CopyButton value={email} copy={copy} />
        {preparation.email && (
          <a
            href={`mailto:${preparation.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(email)}`}
          >
            {copy.openEmail}
          </a>
        )}
      </section>
    </div>
  );
}

function AppointmentDraft({
  facility,
  caseId,
  benefitId,
  language,
  copy,
}: {
  facility: WorkspaceFacility;
  caseId: string;
  benefitId: string | null;
  language: WorkspaceLanguage;
  copy: WorkspaceCopy;
}): JSX.Element {
  const [preparation, setPreparation] = useState<AppointmentPreparation | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function prepare(): Promise<void> {
    setPending(true);
    setError(false);
    try {
      const response = await fetch(APPOINTMENT_PREPARE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          facilityId: facility.id,
          language,
          ...(benefitId ? { benefitId } : {}),
        }),
      });
      if (!response.ok) throw new Error("PREPARATION_FAILED");
      setPreparation(appointmentPreparationSchema.parse(await response.json()));
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <section className={styles.card} aria-labelledby="facility-contact">
        <h2 id="facility-contact">{facility.title}</h2>
        <p>{facility.address}</p>
        <p>{facility.openingHours ?? copy.noHours}</p>
        <FacilityContacts facility={facility} copy={copy} />
        {facility.bookingUrls.map((url) => (
          <p key={url}>
            <a href={url} target="_blank" rel="noreferrer">
              {copy.online}
            </a>
          </p>
        ))}
        {facility.bookingUrls.length > 0 && <p>{copy.bookingNotice}</p>}
        <FacilitySources facility={facility} copy={copy} />
      </section>
      <div>
        <button type="button" onClick={() => void prepare()} disabled={pending}>
          {pending ? copy.preparing : copy.prepareDraft}
        </button>
        {error && <p role="alert">{copy.error}</p>}
      </div>
      {preparation && (
        <DraftEditor key={preparation.callSheet} preparation={preparation} copy={copy} />
      )}
      <CallRehearsal
        caseId={caseId}
        facilityId={facility.id}
        benefitId={benefitId}
        language={language}
        copy={copy}
      />
      <CalendarHold caseId={caseId} facilityId={facility.id} language={language} copy={copy} />
    </>
  );
}

export function WorkspaceAppointments({
  facilities,
  caseId,
  benefitId,
  initialFacilityId,
  language,
  copy,
}: {
  facilities: WorkspaceFacility[];
  caseId: string;
  benefitId: string | null;
  initialFacilityId: string;
  language: WorkspaceLanguage;
  copy: WorkspaceCopy;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState(initialFacilityId);
  const facility = facilities.find((entry) => entry.id === selectedId);
  return (
    <>
      <div className={styles.field}>
        <label htmlFor="appointment-facility">{copy.selectFacility}</label>
        <select
          id="appointment-facility"
          value={facility?.id ?? ""}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          <option value="">{copy.chooseFacility}</option>
          {facilities.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
      </div>
      {facilities.length === 0 && <p className={styles.empty}>{copy.noFacilities}</p>}
      {facility && (
        <AppointmentDraft
          key={`${caseId}:${facility.id}:${benefitId ?? ""}`}
          facility={facility}
          caseId={caseId}
          benefitId={benefitId}
          language={language}
          copy={copy}
        />
      )}
    </>
  );
}
