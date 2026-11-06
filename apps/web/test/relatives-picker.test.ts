// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { relativesCopy } from "../src/features/relatives/copy.ts";
import { RelativeInvite } from "../src/features/relatives/invite.tsx";
import { HelperSettings } from "../src/features/settings/helpers.tsx";
import { panelsCopy } from "../src/features/settings/panels-copy.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
for (const surface of ["workspace", "settings"] as const) {
  test(`FR-R5 ${surface} sends only individually selected fact ids through the relatives flow`, async () => {
    const caseId = randomUUID();
    const subjectId = randomUUID();
    const selected = randomUUID();
    const privateId = randomUUID();
    const id = randomUUID();
    const mutations: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/relatives/invites" && init?.method === "POST") {
          mutations.push(JSON.parse(String(init.body)));
          return Response.json({ id, token: "a".repeat(64), expiresAt: new Date().toISOString() });
        }
        if (url === "/api/relatives/invites")
          return Response.json({
            cases: [{ id: caseId, subjectId, confirmedGoal: "Unterlagen vorbereiten" }],
          });
        if (url.startsWith("/api/relatives/sessions?")) return Response.json({ sessions: [] });
        if (url.startsWith("/api/facts?"))
          return Response.json({
            facts: [
              { id: selected, type: "administrative_fact", value: "Shared value" },
              { id: privateId, type: "administrative_fact", value: "Private value" },
            ],
          });
        return Response.json({ id, caseId, state: "invited", expiresAt: new Date().toISOString() });
      }),
    );
    const view = render(
      surface === "workspace"
        ? createElement(RelativeInvite, { copy: relativesCopy.de })
        : createElement(HelperSettings, { copy: panelsCopy.de }),
    );
    const picker = await view.findByRole("combobox", { name: relativesCopy.de.scopeLabel });
    fireEvent.change(picker, { target: { value: "selected" } });
    fireEvent.click(await view.findByRole("checkbox", { name: /Shared value/ }));
    expect(
      (view.getByRole("checkbox", { name: /Private value/ }) as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(view.getByRole("button", { name: relativesCopy.de.invite }));
    await waitFor(() =>
      expect(mutations).toEqual([
        {
          caseId,
          shareScope: { mode: "restricted", case: true, factTypes: [], factIds: [selected] },
        },
      ]),
    );
    expect(
      ((await view.findByLabelText(relativesCopy.de.link)) as HTMLInputElement).value,
    ).toContain("/helper#");
  });
}
