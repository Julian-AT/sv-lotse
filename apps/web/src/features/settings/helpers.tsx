"use client";
import type { JSX } from "react";
import { relativesCopy } from "../relatives/copy.ts";
import { RelativeInvite } from "../relatives/invite.tsx";
import { type PanelsCopy, panelsCopy } from "./panels-copy.ts";

export { inviteScope } from "../relatives/scope.tsx";

/** Settings and workspace share the same invite picker and approval flow. */
export function HelperSettings({ copy }: { copy: PanelsCopy }): JSX.Element {
  const language = copy.helpers === panelsCopy.en.helpers ? "en" : "de";
  return <RelativeInvite copy={relativesCopy[language]} title={copy.helpers} />;
}
