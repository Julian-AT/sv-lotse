import { expect, test } from "vitest";
import {
  allowedPortalUrl,
  PortalCommandSchema,
  PortalConnectionSchema,
} from "../../src/portal-contract.ts";

test("FR-D7 accepts only exact allowlisted HTTPS portals without URL credentials", () => {
  const allowlist = ["https://portal.example"];
  expect(allowedPortalUrl("https://portal.example/form?step=1", allowlist)).toBe(
    "https://portal.example/form?step=1",
  );
  for (const url of [
    "https://portal.example.attacker.test",
    "http://portal.example",
    "javascript:alert(1)",
    "https://user:pass@portal.example",
    "not a URL",
  ])
    expect(allowedPortalUrl(url, allowlist)).toBeUndefined();
});

test("FR-D7 rejects unapproved fills, empty groups and unsupported commands", () => {
  const envelope = { channel: crypto.randomUUID(), id: crypto.randomUUID() };
  const group = {
    ...envelope,
    kind: "fill",
    url: "https://portal.example/form",
    fields: [{ handle: "name", label: "Name", value: "Approved" }],
  };
  expect(PortalCommandSchema.safeParse(group).success).toBe(false);
  expect(PortalCommandSchema.safeParse({ ...group, approved: false }).success).toBe(false);
  expect(PortalCommandSchema.safeParse({ ...group, approved: true, fields: [] }).success).toBe(
    false,
  );
  expect(PortalCommandSchema.safeParse({ ...group, approved: true }).success).toBe(true);
  expect(PortalCommandSchema.safeParse({ ...envelope, kind: "submit" }).success).toBe(false);
});

test("FR-D7 connection policy rejects paths and wildcard origins", () => {
  const connection = {
    workspaceOrigin: "https://workspace.example",
    portalOrigin: "https://portal.example",
    channel: crypto.randomUUID(),
    allowlist: ["https://portal.example"],
  };
  expect(PortalConnectionSchema.safeParse(connection).success).toBe(true);
  expect(
    PortalConnectionSchema.safeParse({
      ...connection,
      workspaceOrigin: "https://workspace.example/path",
    }).success,
  ).toBe(false);
  expect(PortalConnectionSchema.safeParse({ ...connection, portalOrigin: "*" }).success).toBe(
    false,
  );
});
