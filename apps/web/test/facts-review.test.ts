// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { FactsReview } from "../src/conversation/facts.tsx";
import type { ReviewableFact } from "../src/conversation/schemas.ts";
import { I18nProvider } from "../src/i18n/provider.tsx";

afterEach(cleanup);

const fact = (confirmed: boolean): ReviewableFact => ({
  id: crypto.randomUUID(),
  subjectId: crypto.randomUUID(),
  type: "postal_code",
  value: "1100",
  source: { kind: "statement", turnId: crypto.randomUUID() },
  confidence: 1,
  confirmed,
});

const renderReview = (facts: ReviewableFact[]) =>
  render(
    createElement(
      I18nProvider,
      { locale: "de" },
      createElement(FactsReview, {
        facts,
        error: false,
        retrying: false,
        onRetry: () => undefined,
        onSaved: async () => undefined,
      }),
    ),
  );

test("a new chat with only confirmed facts shows no review card", () => {
  renderReview([fact(true), fact(true)]);
  expect(screen.queryByRole("heading", { name: "Angaben prüfen" })).toBeNull();
});

test("only unconfirmed proposals are listed for review", () => {
  renderReview([fact(true), fact(false)]);
  expect(screen.getByRole("heading", { name: "Angaben prüfen" })).toBeTruthy();
});
