// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { LayoutGuidanceConversation, pageOwnsConversation } from "../src/speech/conversation.tsx";

const route = vi.hoisted(() => ({ pathname: "/" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("../src/speech/provider.tsx", () => ({
  useGuidance: () => ({
    ingest: vi.fn(),
    beginTurn: vi.fn(),
    stop: vi.fn(),
    openDocument: vi.fn(),
    takeActionResults: () => [],
    setCaseId: vi.fn(),
  }),
}));
afterEach(cleanup);

test.each(["/", "/workspace", `/cases/${crypto.randomUUID()}`])(
  "one conversation per screen: %s hosts its own, so the layout adds none",
  (pathname) => {
    route.pathname = pathname;
    render(createElement(LayoutGuidanceConversation, { language: "en" }));
    expect(screen.queryByLabelText("Your message")).toBeNull();
  },
);

test.each(["/documents", "/cases", `/forms/${crypto.randomUUID()}`])(
  "%s has no conversation of its own and keeps the layout's guidance conversation",
  (pathname) => {
    route.pathname = pathname;
    render(createElement(LayoutGuidanceConversation, { language: "en" }));
    expect(screen.getAllByLabelText("Your message")).toHaveLength(1);
  },
);

test("an unknown route outside the app router never hides the guidance conversation", () => {
  expect(pageOwnsConversation(null)).toBe(false);
});
