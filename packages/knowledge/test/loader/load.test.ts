import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadKnowledge } from "../../src/loader/index.ts";
import {
  benefit,
  facility,
  fixtureRoot,
  form,
  office,
  processRecord,
  removeFixture,
  source,
} from "./fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeFixture));
});
async function load(overrides: Record<string, unknown> = {}) {
  const root = await fixtureRoot(overrides);
  roots.push(root);
  return loadKnowledge(root);
}
test("AC1 loads every schema, resolves cyclic record links and fragments, and deeply freezes knowledge", async () => {
  const knowledge = await load();
  expect(Object.keys(knowledge.catalog)).toEqual([benefit.id]);
  expect(knowledge.resolve("ref:catalog/fixture-benefit#criteria")).toEqual(benefit.criteria);
  expect(knowledge.resolve("ref:processes/fixture-process")).toBe(
    knowledge.processes["fixture-process"],
  );
  expect(Object.isFrozen(knowledge)).toBe(true);
  expect(Object.isFrozen(knowledge.catalog)).toBe(true);
  expect(Object.isFrozen(knowledge.catalog[benefit.id]?.criteria[0]?.source)).toBe(true);
  expect(knowledge.allowlist?.origins).toHaveLength(1);
});
test.each([
  [{ ...benefit, sources: [{ ...source, quote: undefined }] }, "sources.0.quote"],
  [{ ...benefit, as_of: undefined }, "as_of"],
  [{ ...benefit, area: "G" }, "area"],
  [{ ...benefit, process: "ref:processes/missing" }, "process"],
  [{ ...benefit, process: "ref:offices/fixture-office" }, "process"],
  [{ ...benefit, unexpected: true }, "unexpected"],
])("AC1 reports file and path for invalid records", async (record, path) => {
  await expect(load({ "catalog/benefit.yaml": record })).rejects.toThrow(
    new RegExp(`catalog/benefit.yaml.*${path.replaceAll(".", "\\.")}`),
  );
});
test("AC1 reports both files and id path for duplicate ids", async () => {
  await expect(load({ "catalog/copy.yaml": benefit })).rejects.toThrow(
    /catalog\/copy.yaml.*id.*catalog\/benefit.yaml/,
  );
});
test("AC1 rejects a dangling fragment", async () => {
  await expect(
    load({ "catalog/benefit.yaml": { ...benefit, forms: ["ref:forms/fixture-form#missing"] } }),
  ).rejects.toThrow(/catalog\/benefit.yaml.*forms.0/);
});

test("AC1 rejects a nonexistent package root instead of treating it as an empty catalog", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await expect(loadKnowledge(`${root}/missing`)).rejects.toThrow(/missing.*\$.*root/);
});

test("AC1 reports the file and root path for duplicate YAML mapping keys", async () => {
  const { writeFile } = await import("node:fs/promises");
  const root = await fixtureRoot();
  roots.push(root);
  await writeFile(`${root}/catalog/benefit.yaml`, "id: first\nid: second\n");
  await expect(loadKnowledge(root)).rejects.toThrow(/catalog\/benefit.yaml.*\$.*YAML/);
});

const onlineChannel = (url: string) => ({ kind: "online", url, verified_at: "2026-11-02" });

test("AC3 loads booking pages with allowlisted origins regardless of path", async () => {
  const channels = [onlineChannel("https://EXAMPLE.org:443/booking?office=central")];
  const knowledge = await load({
    "catalog/benefit.yaml": { ...benefit, appointment_channels: channels },
  });
  expect(knowledge.catalog[benefit.id]?.appointment_channels).toEqual(channels);
});

test.each([
  "https://unlisted.example/booking",
  "https://example.org.evil.test/booking",
  "https://booking.example.org/booking",
  "http://example.org/booking",
  "https://example.org:8443/booking",
])(
  "AC3 rejects unallowlisted booking origin in %s with the benefit file and channel path",
  async (url) => {
    await expect(
      load({
        "catalog/benefit.yaml": {
          ...benefit,
          appointment_channels: [
            ...benefit.appointment_channels,
            onlineChannel("https://example.org/booking"),
            onlineChannel(url),
          ],
        },
      }),
    ).rejects.toMatchObject({
      file: expect.stringContaining("catalog/benefit.yaml"),
      path: "appointment_channels.2.url",
    });
  },
);

test("AC3 requires an allowlist when an online booking channel exists", async () => {
  const root = await fixtureRoot({
    "catalog/benefit.yaml": {
      ...benefit,
      appointment_channels: [
        ...benefit.appointment_channels,
        onlineChannel("https://example.org/booking"),
      ],
    },
  });
  roots.push(root);
  await rm(join(root, "allowlist.yaml"));
  await expect(loadKnowledge(root)).rejects.toMatchObject({
    file: join(root, "catalog/benefit.yaml"),
    path: "appointment_channels.1.url",
  });
});

test("AC3 permits a missing allowlist when there are no online booking channels", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await rm(join(root, "allowlist.yaml"));
  expect((await loadKnowledge(root)).catalog[benefit.id]?.appointment_channels).toEqual(
    benefit.appointment_channels,
  );
});

test("reports awaiting-review counts per record kind without inventing dates", async () => {
  const candidateForm = { ...form, status: "auto", verified_at: undefined };
  const knowledge = await load({
    "catalog/benefit.yaml": { ...benefit, verified_at: undefined },
    "processes/process.yaml": { ...processRecord, verified_at: undefined },
    "offices/nested/office.yml": { ...office, verified_at: undefined },
    "offices/reviewed.yaml": { ...office, id: "reviewed-office" },
    "facilities/facility.yaml": { ...facility, verified_at: undefined },
    "forms/form.json": candidateForm,
  });
  expect(knowledge.awaitingReview).toEqual({
    catalog: 1,
    processes: 1,
    offices: 1,
    facilities: 1,
    forms: 1,
  });
  expect(knowledge.forms[form.id]).toEqual({ ...candidateForm, verified_at: undefined });
  for (const records of [
    knowledge.catalog,
    knowledge.processes,
    knowledge.offices,
    knowledge.facilities,
    knowledge.forms,
  ]) {
    for (const record of Object.values(records)) {
      if (record.id !== "reviewed-office") expect(record.verified_at).toBeUndefined();
    }
  }
  expect(Object.isFrozen(knowledge.awaitingReview)).toBe(true);
});

test("reports zero awaiting-review counts for reviewed and empty collections", async () => {
  expect((await load()).awaitingReview).toEqual({
    catalog: 0,
    processes: 0,
    offices: 0,
    facilities: 0,
    forms: 0,
  });
  const root = await fixtureRoot();
  roots.push(root);
  for (const kind of ["catalog", "processes", "offices", "facilities", "forms"]) {
    await rm(join(root, kind), { recursive: true });
  }
  expect((await loadKnowledge(root)).awaitingReview).toEqual({
    catalog: 0,
    processes: 0,
    offices: 0,
    facilities: 0,
    forms: 0,
  });
});
