import { describe, expect, it } from "vitest";
import {
  createStatusAnnouncer,
  statusCopy,
  statusFor,
  statusPart,
} from "../../src/pipeline/status-copy.ts";

describe("tool status lines", () => {
  it("picks a fixed template per tool family and language", () => {
    expect(statusFor("kb.search", "de-AT")).toBe(statusCopy.de.lookup);
    expect(statusFor("office.resolve", "de")).toBe(statusCopy.de.office);
    expect(statusFor("form.find", "en")).toBe(statusCopy.en.documents);
    expect(statusFor("ui.point", "de")).toBeUndefined();
    expect(statusFor("case.update", "de")).toBeUndefined();
  });

  it("never carries facts: no digits, amounts, links or citations", () => {
    for (const text of Object.values(statusCopy).flatMap((family) => Object.values(family))) {
      expect(text).not.toMatch(/\d|€|https?:|\[passage:/);
      expect(text.length).toBeLessThanOrEqual(60);
    }
  });

  it("announces at most once per turn, on the first slow tool", () => {
    const announce = createStatusAnnouncer("de-AT");
    expect(announce("case.update")).toBeUndefined();
    expect(announce("office.resolve")).toBe(statusCopy.de.office);
    expect(announce("kb.search")).toBeUndefined();
    expect(createStatusAnnouncer("de-AT")("kb.search")).toBe(statusCopy.de.lookup);
  });

  it("streams the status as soon as the tool step starts, before its result and the answer", () => {
    const announce = createStatusAnnouncer("de-AT");
    const parts = [
      { type: "start-step" },
      { type: "tool-input-start", toolName: "kb.search" },
      { type: "tool-input-available", toolName: "kb.search" },
      { type: "tool-output-available" },
      { type: "tool-input-start", toolName: "office.resolve" },
      { type: "text-start" },
      { type: "text-delta" },
    ];
    const stream = parts.flatMap((part) => {
      const status = statusPart(part, announce, "turn-1");
      return status ? [status, part] : [part];
    });
    const statuses = stream.filter((part) => part.type === "data-status");
    expect(statuses).toEqual([
      {
        type: "data-status",
        data: { turnId: "turn-1", text: statusCopy.de.lookup },
        transient: true,
      },
    ]);
    const at = stream.findIndex((part) => part.type === "data-status");
    expect(at).toBeLessThan(stream.findIndex((part) => part.type === "tool-output-available"));
    expect(at).toBeLessThan(stream.findIndex((part) => part.type === "text-delta"));
  });
});
