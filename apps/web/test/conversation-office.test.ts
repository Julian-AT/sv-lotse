// @vitest-environment jsdom
import type { LotseMessage } from "@lotse/brain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { OfficeResults } from "../src/conversation/office.tsx";

afterEach(cleanup);
// Synthetic contact isolates rendering. Real catalog contacts are tested against Postgres.
const office = {
  id: "test-office",
  title: "Administrative contact",
  address: { street: "Test street", postalCode: "1000", city: "Test city" },
  channels: { phone: "+43 1 000" },
  openingHours: "By arrangement",
  sources: [{ url: "https://example.org/contact", quote: "Source quote", asOf: "2026-11-06" }],
};

function message(output: unknown): LotseMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "office.resolve",
        toolCallId: crypto.randomUUID(),
        state: "output-available",
        input: {},
        output,
      },
    ],
  };
}
test("FR-O1 displays the sourced office even when generated prose contains no office details", () => {
  render(createElement(OfficeResults, { message: message(office), language: "de" }));
  expect(screen.getByRole("heading", { name: office.title })).toBeTruthy();
  expect(screen.getByText(office.address.street, { exact: false })).toBeTruthy();
  expect(screen.getByText(office.channels.phone)).toBeTruthy();
  fireEvent.click(screen.getByText("Quellen zur Anlaufstelle"));
  expect(screen.getByText(office.sources[0]?.quote ?? "")).toBeTruthy();
  expect(screen.getByRole("link", { name: "example.org" }).getAttribute("href")).toBe(
    office.sources[0]?.url,
  );
  // Contact channels render as direct actions: call and directions to the sourced address.
  expect(screen.getByRole("link", { name: office.channels.phone }).getAttribute("href")).toBe(
    "tel:+431000",
  );
  expect(screen.getByRole("link", { name: "Route" }).getAttribute("href")).toContain(
    encodeURIComponent(office.address.city),
  );
});
test("FR-O1 withholds incomplete and unsafe office records rather than rendering ungrounded contacts", () => {
  const { container, rerender } = render(
    createElement(OfficeResults, { message: message({ ...office, sources: [] }), language: "de" }),
  );
  expect(container.querySelector("section")).toBeNull();
  rerender(
    createElement(OfficeResults, {
      message: message({
        ...office,
        sources: [{ ...office.sources[0], url: "javascript:alert(1)" }],
      }),
      language: "de",
    }),
  );
  expect(container.querySelector("section")).toBeNull();
});
