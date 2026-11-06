// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { formExportUrl, formPackageUrl } from "../src/features/form-viewer/config.ts";
import { FormPackage } from "../src/features/form-viewer/package.tsx";

const id = "358f7746-7510-4ecf-95e5-b7a23af607be";
const content = {
  attachmentChecklist: ["Bestätigung", "Ausweiskopie"],
  coverLetter: "Teststelle\nAda Beispiel\nAntrag\nBeilagen: Bestätigung",
  pdfUrl: formExportUrl(id),
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("FR-D6 one action displays the checklist, personalised letter and confirmed PDF link", async () => {
  const fetcher = vi.fn(async () => Response.json(content));
  vi.stubGlobal("fetch", fetcher);
  render(createElement(FormPackage, { formInstanceId: id, language: "de", blocked: false }));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "PDF vorbereiten" }));
  await screen.findByRole("link", { name: "PDF herunterladen" });
  expect(screen.getByRole("link", { name: "PDF herunterladen" }).getAttribute("href")).toBe(
    formExportUrl(id),
  );
  expect(screen.getByRole("checkbox", { name: "Bestätigung" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Bestätigung" }));
  expect(screen.getByRole("checkbox", { name: "Bestätigung" }).matches(":checked")).toBe(true);
  expect(screen.getByText(/Teststelle/).textContent).toBe(content.coverLetter);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(formPackageUrl(id), {
    method: "POST",
    credentials: "same-origin",
  });
});

test("FR-D6 package creation waits during typing and does not offer a download on failure", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 409 }));
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    createElement(FormPackage, { formInstanceId: id, language: "en", blocked: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender(createElement(FormPackage, { formInstanceId: id, language: "en", blocked: false }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});

test("FR-D6 a pending request cannot be duplicated and empty checklists remain explicit", async () => {
  let finish: (response: Response) => void = () => {};
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(createElement(FormPackage, { formInstanceId: id, language: "en", blocked: false }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
  fireEvent.click(screen.getByRole("button", { name: "Preparing PDF …" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => finish(Response.json({ ...content, attachmentChecklist: [] })));
  expect(screen.getByText(/No required attachments recorded/)).toBeTruthy();
});

test("FR-D6 rejects a returned URL that is not this instance's authenticated PDF", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ...content, pdfUrl: "https://example.org/private.pdf" })),
  );
  render(createElement(FormPackage, { formInstanceId: id, language: "en", blocked: false }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
