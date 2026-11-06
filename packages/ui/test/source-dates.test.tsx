import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { WhyPanel } from "../src/index.ts";

test("WhyPanel shows only source dates actually supplied by the protocol", () => {
  const source = {
    id: "source",
    title: "Official source",
    url: "https://www.sozialversicherung.at/",
    quote: "Administrative fixture",
    asOf: "",
  };
  const { rerender } = render(<WhyPanel sources={[source]} />);
  expect(screen.queryByText("Stand")).toBeNull();
  rerender(<WhyPanel sources={[{ ...source, asOf: "2026-11-06" }]} />);
  expect(screen.getByText("Stand").tagName).toBe("DT");
  expect(screen.getByText("2026-11-06").getAttribute("datetime")).toBe("2026-11-06");
});
