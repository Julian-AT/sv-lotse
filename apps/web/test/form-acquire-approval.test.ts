// @vitest-environment jsdom
import type { LotseMessage } from "@lotse/brain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { PreviewMessage } from "../src/components/chat/message.tsx";
import { I18nProvider } from "../src/i18n/provider.tsx";

const id = "358f7746-7510-4ecf-95e5-b7a23af607be";
const url = "https://example.org/official-form.pdf";
const message: LotseMessage = {
  id,
  role: "assistant",
  parts: [
    {
      type: "dynamic-tool",
      toolName: "form.acquire",
      toolCallId: id,
      state: "approval-requested",
      input: { url },
      approval: { id },
    },
  ],
};

const summary =
  "Herausgeber: Teststelle\nTitel: Verwaltungsantrag\nStand: 2026-01-15\nURL: https://example.org/official-form.pdf";
afterEach(cleanup);

test("FR-D10 shows acquisition metadata and sends only the user's explicit refusal", () => {
  const decide = vi.fn();
  render(
    createElement(
      I18nProvider,
      { locale: "de" },
      createElement(PreviewMessage, {
        message,
        subjectId: id,
        isLoading: false,
        actionable: true,
        onApproval: decide,
        onAutonomyDecision: vi.fn(async () => {}),
        contexts: [
          {
            approvalId: id,
            toolCallId: id,
            toolName: "form.acquire",
            inputHash: "0".repeat(64),
            caseId: id,
            provenance: [],
            summary,
          },
        ],
      }),
    ),
  );
  expect(screen.getByText(/Herausgeber: Teststelle/).textContent).toBe(summary);
  expect(decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ablehnen" }));
  expect(decide).toHaveBeenCalledExactlyOnceWith(id, false);
});
