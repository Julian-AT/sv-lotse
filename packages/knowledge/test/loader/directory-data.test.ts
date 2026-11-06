import { expect, test } from "vitest";
import { loadKnowledge } from "../../src/loader/index.ts";

test("FR-O2 regional facility data validates with sources, geographic points and no invented review dates", async () => {
  const knowledge = await loadKnowledge();
  const records = Object.values(knowledge.facilities);
  for (const region of ["Steiermark", "Wien"]) {
    const rehabilitation = records.filter(
      (record) => record.type === "rehabilitation" && record.region === region,
    );
    expect(rehabilitation.length).toBeGreaterThanOrEqual(2);
    for (const record of rehabilitation) {
      expect(record.location?.latitude).toBeGreaterThan(46);
      expect(record.location?.longitude).toBeGreaterThan(9);
      expect(record.sources.length).toBeGreaterThan(0);
      expect(record.phone).toBeTruthy();
    }
  }
  expect(records.some((record) => record.type === "care_advice")).toBe(true);
});

test("FR-O2 loads mobile care and checkup providers in both cities from official public directories", async () => {
  const records = Object.values((await loadKnowledge()).facilities);
  for (const city of ["Wien", "Graz"]) {
    for (const type of ["Mobile Pflege", "Vorsorgeuntersuchung"]) {
      const matches = records.filter(
        (record) => record.address?.locality === city && record.type === type,
      );
      expect(matches.length).toBeGreaterThan(0);
      for (const record of matches) {
        expect(
          record.sources.every((source) =>
            [
              "www.fsw.at",
              "www.wien.gv.at",
              "www.graz.at",
              "www.oegk.at",
              "www.sozialversicherung.gv.at",
              "data.wien.gv.at",
            ].includes(new URL(source.url).hostname),
          ),
        ).toBe(true);
        expect(record.sources.every((source) => source.quote && source.retrieved_at)).toBe(true);
        expect(record.verified_at).toBeUndefined();
      }
    }
  }
  const advice = records.find((record) => record.remote && record.phone === "1450");
  expect(advice?.location).toBeUndefined();
  expect(advice?.opening_hours).toMatchObject({ monday: "00:00–24:00", sunday: "00:00–24:00" });
  expect(advice?.sources[0]?.url).toBe("https://www.gesundheit.gv.at/service/notruf/hotline.html");
});
