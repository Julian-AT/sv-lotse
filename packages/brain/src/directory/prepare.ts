import type { Fact } from "@lotse/protocol";
import { directoryCopy } from "./copy.ts";
import type { AppointmentOption } from "./options.ts";

export type CallDrafts = { callSheet: string; emailDraft: string };
export function callDrafts(
  option: Pick<AppointmentOption, "channels" | "title" | "timeWindow" | "requestedPreferences">,
  administrativeFacts: readonly Fact[],
): CallDrafts {
  const copy = directoryCopy.de;
  const contact = Object.values(option.channels).join(" · ");
  const details = administrativeFacts
    .filter((fact) => typeof fact.value === "string" || typeof fact.value === "number")
    .map((fact) => String(fact.value));
  const window = option.timeWindow
    ? `${copy.preferences}: ${option.timeWindow.from} – ${option.timeWindow.to}`
    : copy.holdMissing;
  const preferenceDetails = option.requestedPreferences
    ? [
        `${copy.language}: ${option.requestedPreferences.language}`,
        `${copy.accessibility}: ${option.requestedPreferences.accessibility.join(", ")}`,
      ]
    : [];
  return {
    callSheet: [
      copy.callTitle,
      option.title ?? "",
      `${copy.recipient}: ${contact}`,
      copy.introduction,
      ...copy.questions,
      window,
      ...preferenceDetails,
      ...(details.length ? [copy.details, ...details] : []),
      copy.noBooking,
    ].join("\n"),
    emailDraft: [
      copy.emailSubject,
      ...(option.channels.email ? [`${copy.recipient}: ${option.channels.email}`] : []),
      "",
      copy.emailGreeting,
      "",
      copy.emailBody,
      window,
      ...preferenceDetails,
      ...(details.length ? [copy.details, ...details] : []),
      "",
      copy.emailClosing,
    ].join("\n"),
  };
}

export function callRehearsal(
  callSheet: string,
  option?: AppointmentOption,
  language: "de" | "en" = "de",
): {
  notice: string;
  callSheet: string;
  script: { role: "caller" | "office"; text: string }[];
} {
  const copy = directoryCopy[language];
  return {
    notice: copy.rehearsalNotice,
    callSheet,
    script: [
      { role: "office", text: copy.rehearsalClerk },
      { role: "caller", text: [copy.introduction, option?.title ?? ""].filter(Boolean).join(" ") },
      ...(option?.timeWindow
        ? [
            {
              role: "caller" as const,
              text: `${copy.preferences}: ${option.timeWindow.from} – ${option.timeWindow.to}`,
            },
          ]
        : []),
      { role: "caller", text: copy.questions.join(" ") },
      { role: "office", text: copy.rehearsalDocuments },
      { role: "caller", text: copy.rehearsalClose },
    ],
  };
}
