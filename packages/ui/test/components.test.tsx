import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Citation } from "../src/index";
import * as publicApi from "../src/index";
import {
  Alert,
  ApprovalCard,
  Badge,
  Button,
  Card,
  Checkbox,
  CitationChip,
  ConversationBubble,
  Dialog,
  Disclosure,
  DocumentChecklist,
  FactCard,
  Field,
  FormFieldOverlay,
  Heading,
  IconButton,
  Inline,
  JourneyMap,
  Link,
  Radio,
  SafetyNotice,
  Select,
  Skeleton,
  Spinner,
  Stack,
  Tabs,
  Tag,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
  WhyPanel,
} from "../src/index";

// Constructed administrative fixtures; no service or domain catalog is replaced.
export const source: Citation = {
  id: "source-example",
  title: "Unterlage",
  url: "https://www.sozialversicherung.at/",
  quote: "Datum der Ausstellung",
  asOf: "2026-11-06",
  legalBasis: "Dokumentangabe",
};
const noop = (): void => {};
type Example = { name: string; element: ReactElement; verify: () => void | Promise<void> };
const examples: Example[] = [
  {
    name: "Button",
    element: <Button onClick={noop}>Weiter</Button>,
    verify: async () => {
      await userEvent.setup().click(screen.getByRole("button", { name: "Weiter" }));
    },
  },
  {
    name: "IconButton",
    element: (
      <IconButton label="Öffnen">
        <span aria-hidden="true">+</span>
      </IconButton>
    ),
    verify: () => {
      expect(screen.getByRole("button", { name: "Öffnen" })).toBeTruthy();
    },
  },
  {
    name: "Link",
    element: <Link href="https://www.sozialversicherung.at/">Quelle</Link>,
    verify: () => {
      expect(screen.getByRole("link").getAttribute("href")).toBe(source.url);
    },
  },
  {
    name: "Card",
    element: <Card aria-label="Übersicht">Inhalt</Card>,
    verify: () => {
      expect(screen.getByText("Inhalt")).toBeTruthy();
    },
  },
  {
    name: "Stack",
    element: (
      <Stack gap="large">
        <Text>Erster</Text>
        <Text>Zweiter</Text>
      </Stack>
    ),
    verify: () => {
      expect(screen.getByText("Erster").parentElement?.style.gap).toBe("var(--lotse-space-large)");
    },
  },
  {
    name: "Inline",
    element: (
      <Inline>
        <Text>Erster</Text>
        <Text>Zweiter</Text>
      </Inline>
    ),
    verify: () => {
      expect(screen.getByText("Zweiter").parentElement?.classList.contains("lotse-inline")).toBe(
        true,
      );
    },
  },
  {
    name: "Heading",
    element: <Heading level={3}>Übersicht</Heading>,
    verify: () => {
      expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Übersicht");
    },
  },
  {
    name: "Text",
    element: <Text tone="muted">Hinweis</Text>,
    verify: () => {
      expect(screen.getByText("Hinweis").getAttribute("data-tone")).toBe("muted");
    },
  },
  {
    name: "Badge",
    element: <Badge tone="success">Erledigt</Badge>,
    verify: () => {
      expect(screen.getByText("Erledigt").getAttribute("data-tone")).toBe("success");
    },
  },
  {
    name: "Tag",
    element: <Tag onRemove={noop}>Unterlage</Tag>,
    verify: async () => {
      await userEvent.setup().click(screen.getByRole("button", { name: "Entfernen: Unterlage" }));
    },
  },
  {
    name: "Alert",
    element: <Alert tone="warning">Bitte prüfen</Alert>,
    verify: () => {
      expect(screen.getByRole("alert").textContent).toContain("Bitte prüfen");
      expect(screen.getByRole("alert").textContent).toContain("Achtung");
    },
  },
  {
    name: "Dialog",
    element: (
      <Dialog open title="Prüfen" onClose={noop}>
        <Text>Angaben</Text>
      </Dialog>
    ),
    verify: () => {
      expect(screen.getByRole("dialog", { name: "Prüfen" }).getAttribute("aria-modal")).toBe(
        "true",
      );
    },
  },
  {
    name: "Tooltip",
    element: <Tooltip content="Weitere Angaben" label="Hilfe" />,
    verify: async () => {
      await userEvent.setup().tab();
      expect(screen.getByRole("tooltip").textContent).toBe("Weitere Angaben");
    },
  },
  {
    name: "Tabs",
    element: (
      <Tabs
        label="Ansicht"
        items={[
          { id: "one", label: "Erste", content: "Inhalt eins" },
          { id: "two", label: "Zweite", content: "Inhalt zwei" },
        ]}
      />
    ),
    verify: async () => {
      await userEvent.setup().click(screen.getByRole("tab", { name: "Zweite" }));
      expect(screen.getByRole("tabpanel").textContent).toBe("Inhalt zwei");
    },
  },
  {
    name: "Disclosure",
    element: <Disclosure summary="Mehr">Details</Disclosure>,
    verify: async () => {
      await userEvent.setup().click(screen.getByText("Mehr"));
      expect(screen.getByText("Mehr").parentElement?.hasAttribute("open")).toBe(true);
    },
  },
  {
    name: "Field",
    element: (
      <Field label="Name" hint="Wie im Dokument" error="Bitte ergänzen">
        <TextInput />
      </Field>
    ),
    verify: () => {
      const input = screen.getByRole("textbox", { name: "Name" });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const descriptions = input.getAttribute("aria-describedby")?.split(" ") ?? [];
      expect(descriptions.map((id) => document.getElementById(id)?.textContent)).toEqual([
        "Wie im Dokument",
        "Bitte ergänzen",
      ]);
    },
  },
  {
    name: "TextInput",
    element: <TextInput aria-label="Name" />,
    verify: async () => {
      const input = screen.getByRole("textbox");
      await userEvent.setup().type(input, "Ada");
      expect((input as HTMLInputElement).value).toBe("Ada");
    },
  },
  {
    name: "Select",
    element: (
      <Select aria-label="Sprache">
        <option value="de">Deutsch</option>
        <option value="en">English</option>
      </Select>
    ),
    verify: async () => {
      const select = screen.getByRole("combobox");
      await userEvent.setup().selectOptions(select, "en");
      expect((select as HTMLSelectElement).value).toBe("en");
    },
  },
  {
    name: "Checkbox",
    element: <Checkbox label="Einverstanden" />,
    verify: async () => {
      const input = screen.getByRole("checkbox");
      await userEvent.setup().click(input);
      expect((input as HTMLInputElement).checked).toBe(true);
    },
  },
  {
    name: "Radio",
    element: <Radio label="Deutsch" name="language" value="de" />,
    verify: async () => {
      const input = screen.getByRole("radio");
      await userEvent.setup().click(input);
      expect((input as HTMLInputElement).checked).toBe(true);
    },
  },
  {
    name: "Spinner",
    element: <Spinner />,
    verify: () => {
      expect(screen.getByRole("status").textContent).toContain("Wird geladen");
    },
  },
  {
    name: "Skeleton",
    element: <Skeleton />,
    verify: () => {
      expect(screen.getByRole("status").textContent).toContain("Wird geladen");
    },
  },
  {
    name: "VisuallyHidden",
    element: <VisuallyHidden>Nur vorgelesen</VisuallyHidden>,
    verify: () => {
      expect(screen.getByText("Nur vorgelesen").className).toContain("lotse-visually-hidden");
    },
  },
  {
    name: "CitationChip",
    element: <CitationChip source={source} />,
    verify: () => {
      expect(screen.getByRole("link", { name: "Unterlage" }).getAttribute("href")).toBe(source.url);
    },
  },
  {
    name: "ConversationBubble",
    element: (
      <ConversationBubble
        speaker="assistant"
        text="Ich bereite die Unterlagen vor."
        streaming
        citations={[source]}
      />
    ),
    verify: () => {
      expect(screen.getByRole("article").getAttribute("aria-busy")).toBe("true");
      expect(screen.getByRole("link", { name: source.title })).toBeTruthy();
    },
  },
  {
    name: "WhyPanel",
    element: <WhyPanel sources={[source]} confidence="Belegt" unknowns={["Ausstellungsort"]} />,
    verify: () => {
      expect(screen.getByText(source.quote).tagName).toBe("BLOCKQUOTE");
      expect(screen.getByText(source.asOf).getAttribute("datetime")).toBe(source.asOf);
      expect(screen.getByText("Ausstellungsort")).toBeTruthy();
      expect(screen.getByText("Dokumentangabe")).toBeTruthy();
    },
  },
  {
    name: "ApprovalCard",
    element: (
      <ApprovalCard
        title="Angaben übernehmen"
        changes={["Datum eintragen"]}
        provenance={[source]}
        onApprove={noop}
        onDecline={noop}
      />
    ),
    verify: () => {
      expect(screen.getByRole("button", { name: "Zustimmen" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Ablehnen" })).toBeTruthy();
      expect(screen.getByText("Datum eintragen")).toBeTruthy();
    },
  },
  {
    name: "FactCard",
    element: (
      <FactCard
        label="Ausstellungsdatum"
        value="6. November"
        state="draft"
        source={source}
        onConfirm={noop}
        onEdit={noop}
        onReject={noop}
      />
    ),
    verify: () => {
      expect(screen.getByText("Entwurf")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Bestätigen" })).toBeTruthy();
    },
  },
  {
    name: "JourneyMap",
    element: (
      <JourneyMap
        steps={[
          {
            id: "step",
            title: "Unterlagen prüfen",
            status: "prepared",
            owner: "pilot",
            dueDate: "2026-11-10",
          },
        ]}
      />
    ),
    verify: () => {
      expect(screen.getByText("Vom Lotsen vorbereitet, wartet auf Sie")).toBeTruthy();
      expect(screen.getByText("Lotse")).toBeTruthy();
      expect(screen.getByText("2026-11-10").getAttribute("datetime")).toBe("2026-11-10");
    },
  },
  {
    name: "DocumentChecklist",
    element: (
      <DocumentChecklist
        items={[
          {
            id: "doc",
            title: "Nachweis",
            status: "obtainable",
            where: "Bei der ausstellenden Stelle",
            source,
          },
        ]}
      />
    ),
    verify: () => {
      expect(screen.getByText("Erhältlich")).toBeTruthy();
      expect(screen.getByText("Bei der ausstellenden Stelle")).toBeTruthy();
    },
  },
  {
    name: "SafetyNotice",
    element: (
      <SafetyNotice
        title="Hilfe"
        text="Hier finden Sie die angegebenen Kontakte."
        contacts={[{ label: "Rettung", number: "144" }]}
      />
    ),
    verify: () => {
      expect(screen.getByRole("link", { name: "Rettung 144" }).getAttribute("href")).toBe(
        "tel:144",
      );
    },
  },
  {
    name: "FormFieldOverlay",
    element: (
      <FormFieldOverlay
        label="Datum"
        value="6. November"
        state="draft"
        source={source}
        bounds={{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }}
      />
    ),
    verify: () => {
      const overlay = screen.getByRole("group", { name: "Datum" });
      expect(overlay.style.left).toBe("10%");
      expect(overlay.style.top).toBe("20%");
      expect(screen.getByText("Entwurf")).toBeTruthy();
    },
  },
];

describe("AC1: every component renders, behaves and has zero axe violations", () => {
  for (const example of examples) {
    it(example.name, async () => {
      render(<main>{example.element}</main>);
      await example.verify();
      // jsdom has no canvas/layout: contrast is computed independently in tokens.test.ts.
      const result = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(result.violations).toEqual([]);
    });
  }
});

it("buttons never submit by default, loading prevents repeated actions and variants remain named", async () => {
  const onClick = vi.fn();
  const { rerender } = render(<Button onClick={onClick}>Weiter</Button>);
  expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  await userEvent.setup().click(screen.getByRole("button"));
  expect(onClick).toHaveBeenCalledTimes(1);
  for (const variant of ["primary", "secondary", "ghost", "danger"] as const) {
    rerender(
      <Button loading variant={variant} onClick={onClick}>
        Weiter
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole("button"));
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
  }
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("Tag calls its removal callback", async () => {
  const remove = vi.fn();
  render(<Tag onRemove={remove}>Unterlage</Tag>);
  await userEvent.setup().click(screen.getByRole("button"));
  expect(remove).toHaveBeenCalledOnce();
});

it("unsafe citation URLs cannot become executable links", () => {
  render(<CitationChip source={{ ...source, url: "javascript:alert(1)" }} />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText(source.title)).toBeTruthy();
});

it("radio choices share native mutually exclusive selection", async () => {
  render(
    <fieldset>
      <legend>Sprache</legend>
      <Radio name="lang" label="Deutsch" value="de" />
      <Radio name="lang" label="English" value="en" />
    </fieldset>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Deutsch"));
  await user.click(screen.getByLabelText("English"));
  expect((screen.getByLabelText("Deutsch") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText("English") as HTMLInputElement).checked).toBe(true);
});

it("the user bubble identifies the speaker without a colour cue", () => {
  render(<ConversationBubble speaker="user" text="Meine Unterlagen" />);
  expect(screen.getByRole("article", { name: "Sie" }).textContent).toContain("Meine Unterlagen");
});

it("all checklist states and journey owners have visible text", () => {
  render(
    <>
      <DocumentChecklist
        items={[
          { id: "a", title: "Kopie", status: "have" },
          { id: "b", title: "Original", status: "missing", where: "Ausstellende Stelle" },
        ]}
      />
      <JourneyMap
        steps={[
          { id: "a", title: "Prüfung", status: "current", owner: "user" },
          { id: "b", title: "Bearbeitung", status: "pending", owner: "office" },
          { id: "c", title: "Vorbereitung", status: "completed", owner: "pilot" },
        ]}
      />
    </>,
  );
  for (const label of [
    "Vorhanden",
    "Fehlt",
    "Sie",
    "Stelle",
    "Lotse",
    "Offen",
    "In Arbeit",
    "Erledigt",
  ]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(
    within(screen.getByRole("list", { name: "Ihr Weg" })).getAllByRole("listitem"),
  ).toHaveLength(3);
});

it("AC1: the accessibility catalogue covers every publicly exported component", () => {
  const components = Object.entries(publicApi)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
    .sort();
  expect(examples.map((example) => example.name).sort()).toEqual(components);
});

it("Field generates unique label relationships and preserves extra descriptions", () => {
  render(
    <>
      <Field label="Name" hint="Dokumentname">
        <TextInput aria-describedby="additional" />
      </Field>
      <Field label="Sprache">
        <Select>
          <option>Deutsch</option>
        </Select>
      </Field>
      <p id="additional">Zusatzangabe</p>
    </>,
  );
  const name = screen.getByRole("textbox", { name: "Name" });
  const language = screen.getByRole("combobox", { name: "Sprache" });
  expect(name.id).not.toBe(language.id);
  expect(
    name
      .getAttribute("aria-describedby")
      ?.split(" ")
      .map((id) => document.getElementById(id)?.textContent),
  ).toEqual(["Dokumentname", "Zusatzangabe"]);
});
