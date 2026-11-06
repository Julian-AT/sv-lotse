import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  chooseApplyPage,
  matchBenefit,
  onlineApplyText,
  pageOwner,
} from "../../src/conversation/apply-page.ts";

const catalogDir = resolve(import.meta.dirname, "../../../knowledge/catalog");
const records = readdirSync(catalogDir)
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => parse(readFileSync(resolve(catalogDir, file), "utf8")));
const model = new MockLanguageModelV4();

describe("matchBenefit", () => {
  it.each([
    ["Ich möchte Pflegegeld beantragen", "pflegegeld", "pva"],
    ["Bitte den Antrag auf Reha/Kur ausfüllen", "medical-rehabilitation", "pva"],
    ["Fahrtkosten zur Dialyse bei der ÖGK beantragen", "oegk-transportkosten", "oegk"],
    ["Wie beantrage ich die Rezeptgebührenbefreiung?", "rezeptgebuehrenbefreiung", "oegk"],
    ["Wahlarzt-Kostenerstattung einreichen", "oegk-wahlarzt-kostenerstattung", "oegk"],
    ["Antrag für Heilbehelfe/Hilfsmittel", "heilbehelfe-hilfsmittel", "oegk"],
    ["Krankengeld beantragen", "oegk-krankengeld", "oegk"],
    ["Kinderbetreuungsgeld beantragen", "familie-kinderbetreuungsgeld", "oegk"],
    ["Familienbeihilfe beantragen", "familie-familienbeihilfe", "bmf"],
    ["Förderung der 24-Stunden-Betreuung beantragen", "pflege-24-stunden-betreuung", "sms"],
    ["Pflegekarenzgeld beantragen", "pflegekarenzgeld", "sms"],
    ["Selbstversicherung beantragen", "oegk-selbstversicherung", "oegk"],
  ])("%s → %s", (text, id, carrier) => {
    expect(matchBenefit(records, [text])).toMatchObject({ id, carrier });
  });

  it("prefers the newest text and ignores programme-only benefits", () => {
    expect(matchBenefit(records, ["Krankengeld", "Pflegegeld"])?.id).toBe("oegk-krankengeld");
    expect(matchBenefit(records, ["Vorsorgeuntersuchung beantragen"])).toBeUndefined();
    expect(matchBenefit(records, ["Wie komme ich zu einer Wohnung?"])).toBeUndefined();
  });
});

describe("chooseApplyPage", () => {
  const pflegegeld = matchBenefit(records, ["Pflegegeld"]);
  const krankengeld = matchBenefit(records, ["Krankengeld"]);

  it("opens the live apply page and fills when it links the application PDF", async () => {
    const choice = await chooseApplyPage({
      benefit: krankengeld,
      model,
      find: async (query) => {
        expect(query).toMatchObject({ query: "Krankengeld Antrag", carrier: "oegk" });
        return {
          url: "https://www.oegk.at/krankengeld",
          title: "Krankengeld",
          formPdf: "https://www.oegk.at/antrag.pdf",
        };
      },
    });
    expect(choice).toMatchObject({
      url: "https://www.oegk.at/krankengeld",
      formPdf: "https://www.oegk.at/antrag.pdf",
      fallback: false,
      sentence:
        "Ich öffne die Seite der ÖGK zu Krankengeld und zeige Ihnen, wo der Antrag steht. Danach fülle ich das Formular für Sie aus.",
    });
  });

  it("falls back to the verified page when the lookup fails or is slow", async () => {
    const failed = await chooseApplyPage({
      benefit: pflegegeld,
      model,
      find: async () => {
        throw new Error("search down");
      },
    });
    expect(failed).toMatchObject({ url: "https://www.pv.at/web/pflegegeld", fallback: true });
    const started = Date.now();
    const slow = await chooseApplyPage({
      benefit: pflegegeld,
      registered: { formId: "svbox-pflegegeld", name: "Pflegegeld" },
      model,
      budgetMs: 50,
      find: () => new Promise(() => {}),
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(slow).toMatchObject({ url: "https://www.pv.at/web/pflegegeld", fallback: true });
  });

  it("never opens a page off the allowlist or invents one", async () => {
    await expect(
      chooseApplyPage({
        benefit: krankengeld,
        model,
        find: async () => ({ url: "https://www.krankengeld-hilfe.at/antrag", title: "x" }),
      }),
    ).resolves.toBeUndefined();
    await expect(
      chooseApplyPage({ benefit: krankengeld, model, find: async () => undefined }),
    ).resolves.toBeUndefined();
  });
});

describe("page copy", () => {
  it("names the carrier by host and quotes the online apply link", () => {
    expect(pageOwner("https://www.sozialministeriumservice.gv.at/x")).toBe(
      "die Seite des Sozialministeriumservice",
    );
    expect(pageOwner("https://www.oesterreich.gv.at/x")).toBe(
      "die offizielle Seite auf oesterreich.gv.at",
    );
    const text = onlineApplyText(
      {
        url: "https://www.bmf.gv.at/familienbeihilfe",
        title: "Familienbeihilfe",
        benefit: "Familienbeihilfe",
        apply: { text: "FinanzOnline", href: "https://finanzonline.bmf.gv.at/" },
        sentence: "",
        label: "",
        fallback: false,
      },
      false,
    );
    expect(text).toContain("über „FinanzOnline“");
    expect(text).toContain("schicke nichts ab");
  });
});
