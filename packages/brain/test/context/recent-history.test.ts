import { expect, it } from "vitest";
import { recentHistory } from "../../src/context/index.ts";
import type { LotseMessage } from "../../src/tools/types.ts";

const message = (id: string, text: string): LotseMessage =>
  ({ id, role: "assistant", parts: [{ type: "text", text }] }) as unknown as LotseMessage;

it("keeps the newest message even when it alone is over the history budget", () => {
  const huge = message("big", "x".repeat(400_000));
  expect(recentHistory([message("old", "hallo"), huge]).map((item) => item.id)).toEqual(["big"]);
});

it("keeps several short messages within the budget", () => {
  const history = [message("a", "eins"), message("b", "zwei"), message("c", "drei")];
  expect(recentHistory(history).map((item) => item.id)).toEqual(["a", "b", "c"]);
});
