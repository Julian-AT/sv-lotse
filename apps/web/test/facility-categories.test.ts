// @vitest-environment jsdom

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkspaceFacility } from "@lotse/brain/workspace/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { workspaceCopy } from "../src/features/workspace/copy.ts";
import { WorkspaceFacilities } from "../src/features/workspace/facilities.tsx";

afterEach(cleanup);

test("FR-O2 exposes the sourced categories as offer filters and preserves place searching", async () => {
  // Read actual directory JSON as test input, without bringing server loaders into jsdom.
  const root = resolve(process.cwd(), "../../packages/knowledge/facilities");
  const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith(".json"));
  const recordSchema = z.object({
    id: z.string(),
    name_de: z.string(),
    type: z.string(),
    region: z.string().optional(),
    address: z
      .object({ street: z.string(), postal_code: z.string(), locality: z.string() })
      .optional(),
    location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    url: z.string().optional(),
    services: z.array(z.string()).optional(),
    sources: z.array(z.object({ url: z.string(), quote: z.string(), retrieved_at: z.string() })),
    as_of: z.string(),
  });
  const records = await Promise.all(
    files.map(async (file) =>
      recordSchema.parse(JSON.parse(await readFile(resolve(root, file), "utf8"))),
    ),
  );
  const facilities: WorkspaceFacility[] = records.map((record) => ({
    id: record.id,
    title: record.name_de,
    type: record.type,
    region: record.region ?? null,
    address: record.address
      ? `${record.address.street}, ${record.address.postal_code} ${record.address.locality}`
      : "",
    location: record.location ?? null,
    openingHours: null,
    phone: record.phone ?? null,
    email: record.email ?? null,
    url: record.url ?? null,
    bookingUrls: [],
    accessibility: null,
    services: [...(record.services ?? [])],
    sources: [...record.sources],
    asOf: record.as_of,
    distanceKm: null,
  }));
  const copy = workspaceCopy.de;
  render(createElement(WorkspaceFacilities, { facilities, copy }));
  for (const category of ["Mobile Pflege", "Vorsorgeuntersuchung", "Telefonische Beratung"]) {
    expect(screen.getByRole("option", { name: category })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(copy.type), { target: { value: category } });
    const expected = facilities.filter((facility) => facility.type === category);
    expect(expected.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(
      expected.map((facility) => facility.title),
    );
  }
  fireEvent.change(screen.getByLabelText(copy.type), { target: { value: "Vorsorgeuntersuchung" } });
  fireEvent.change(screen.getByLabelText(copy.search), { target: { value: "Graz" } });
  expect(screen.getAllByRole("heading")).toHaveLength(1);
  expect(screen.getByRole("heading").textContent).toContain("Graz");
  expect(screen.getByRole("button", { name: copy.showOnMap })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Telefon/ }).getAttribute("href")).toMatch(/^tel:/);
});
