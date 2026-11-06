import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { en } from "../src/copy/en";
import { ApprovalCard, Button, Dialog, FactCard, Tabs, TextInput, Tooltip } from "../src/index";

const source = {
  id: "example",
  title: "Unterlage",
  quote: "Datum",
  url: "https://www.sozialversicherung.at/",
  asOf: "2026-11-06",
};

it("AC2: ApprovalCard exposes both decisions by Tab, Enter and Space without global shortcuts", async () => {
  const approve = vi.fn();
  const decline = vi.fn();
  const user = userEvent.setup();
  render(
    <ApprovalCard
      title="Änderung prüfen"
      changes={["Datum eintragen"]}
      provenance={[source]}
      onApprove={approve}
      onDecline={decline}
    />,
  );
  await user.tab(); // provenance link
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Zustimmen" }));
  await user.keyboard("{Enter}");
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ablehnen" }));
  await user.keyboard(" ");
  expect(approve).toHaveBeenCalledOnce();
  expect(decline).toHaveBeenCalledOnce();
  expect(screen.getByText(/Tabulator/)).toBeTruthy();
  expect(screen.getByText(/Sagen Sie/)).toBeTruthy();
});

it("AC2: pending approval disables both decisions", async () => {
  const approve = vi.fn();
  const decline = vi.fn();
  render(
    <ApprovalCard
      title="Prüfen"
      changes={[]}
      provenance={[]}
      pending
      onApprove={approve}
      onDecline={decline}
    />,
  );
  const user = userEvent.setup();
  for (const button of screen.getAllByRole("button")) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
  }
  expect(approve).not.toHaveBeenCalled();
  expect(decline).not.toHaveBeenCalled();
});

it("AC2: FactCard confirm, edit and reject work with keyboard in draft and confirmed states", async () => {
  const confirm = vi.fn();
  const edit = vi.fn();
  const reject = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(
    <FactCard
      label="Datum"
      value="6. November"
      state="draft"
      source={source}
      onConfirm={confirm}
      onEdit={edit}
      onReject={reject}
    />,
  );
  await user.tab(); // source link
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bestätigen" }));
  await user.keyboard("{Enter}");
  await user.tab();
  await user.keyboard(" ");
  await user.tab();
  await user.keyboard("{Enter}");
  expect(confirm).toHaveBeenCalledOnce();
  expect(edit).toHaveBeenCalledOnce();
  expect(reject).toHaveBeenCalledOnce();
  rerender(
    <FactCard
      label="Datum"
      value="6. November"
      state="confirmed"
      source={source}
      onConfirm={confirm}
      onEdit={edit}
      onReject={reject}
    />,
  );
  expect(screen.queryByRole("button", { name: "Bestätigen" })).toBeNull();
  expect(screen.getByText("Bestätigt")).toBeTruthy();
  screen.getByRole("button", { name: "Bearbeiten" }).focus();
  await user.keyboard("{Enter}");
  await user.tab();
  await user.keyboard(" ");
  expect(edit).toHaveBeenCalledTimes(2);
  expect(reject).toHaveBeenCalledTimes(2);
});

function DialogExample(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Öffnen</Button>
      <TextInput aria-label="Außerhalb" />
      <Dialog open={open} title="Prüfen" onClose={() => setOpen(false)}>
        <Button>Erste Aktion</Button>
        <Button disabled>Gesperrt</Button>
        <Button>Letzte Aktion</Button>
      </Dialog>
    </>
  );
}

describe("AC2: Dialog focus", () => {
  it("traps forward and reverse Tab, makes background inert, closes with Escape and restores the opener", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <DialogExample />
      </StrictMode>,
    );
    const opener = screen.getByRole("button", { name: "Öffnen" });
    await user.click(opener);
    const close = screen.getByRole("button", { name: "Schließen" });
    expect(document.activeElement).toBe(close);
    expect(opener.closest("[inert]")).toBeTruthy();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Letzte Aktion" }));
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erste Aktion" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Letzte Aktion" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.closest("[inert]")).toBeNull();
  });

  it("closes through its named close button and restores focus on unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DialogExample />);
    const opener = screen.getByRole("button", { name: "Öffnen" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(document.activeElement).toBe(opener);
    await user.click(opener);
    unmount();
    expect(document.querySelector("[inert]")).toBeNull();
  });
});

it("Tabs supports roving focus, wrapping, Home/End and skips disabled tabs", async () => {
  const changed = vi.fn();
  render(
    <Tabs
      label="Ansicht"
      onValueChange={changed}
      items={[
        { id: "a", label: "Erste", content: "Eins" },
        { id: "b", label: "Gesperrt", content: "Zwei", disabled: true },
        { id: "c", label: "Letzte", content: "Drei" },
      ]}
    />,
  );
  const user = userEvent.setup();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Erste" }));
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Letzte" }));
  expect(screen.getByRole("tabpanel").textContent).toBe("Drei");
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Erste" }));
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Letzte" }));
  await user.keyboard("{Home}{ArrowLeft}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Letzte" }));
  expect(changed).toHaveBeenCalledWith("c");
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("tabpanel"));
});

it("Tooltip appears on hover or focus, dismisses with Escape and stays dismissed until leaving", async () => {
  render(<Tooltip label="Hilfe" content="Weitere Angaben" />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Hilfe" });
  await user.hover(trigger);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).toBeNull();
  await user.unhover(trigger);
  await user.tab();
  expect(screen.getByRole("tooltip").id).toBe(trigger.getAttribute("aria-describedby"));
  await user.tab();
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("FR-L1: all default labels can be replaced with English copy", () => {
  render(
    <ApprovalCard
      labels={en}
      title="Review"
      changes={[]}
      provenance={[]}
      onApprove={() => {}}
      onDecline={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
});

it("Dialog contains programmatic focus and restores existing background state", async () => {
  const background = document.createElement("div");
  background.setAttribute("inert", "");
  background.setAttribute("aria-hidden", "true");
  document.body.append(background);
  const user = userEvent.setup();
  const { unmount } = render(<DialogExample />);
  await user.click(screen.getByRole("button", { name: "Öffnen" }));
  screen.getByLabelText("Außerhalb").focus();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Schließen" }));
  await user.keyboard("{Escape}");
  expect(background.hasAttribute("inert")).toBe(true);
  expect(background.getAttribute("aria-hidden")).toBe("true");
  unmount();
  background.remove();
});

it("Escape dismisses a tooltip before closing its containing Dialog", async () => {
  const close = vi.fn();
  render(
    <Dialog open title="Prüfen" onClose={close}>
      <Tooltip content="Zusätzliche Angaben" label="Hilfe" />
    </Dialog>,
  );
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole("tooltip")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(close).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(close).toHaveBeenCalledOnce();
});

it("controlled Tabs emits a proposed selection and follows the caller's selection", async () => {
  const changed = vi.fn();
  const items = [
    { id: "a", label: "Erste", content: "Eins" },
    { id: "b", label: "Zweite", content: "Zwei" },
  ];
  const { rerender } = render(
    <Tabs label="Ansicht" items={items} value="a" onValueChange={changed} />,
  );
  await userEvent.setup().click(screen.getByRole("tab", { name: "Zweite" }));
  expect(changed).toHaveBeenCalledWith("b");
  expect(screen.getByRole("tabpanel").textContent).toBe("Eins");
  rerender(<Tabs label="Ansicht" items={items} value="b" onValueChange={changed} />);
  expect(screen.getByRole("tabpanel").textContent).toBe("Zwei");
});
