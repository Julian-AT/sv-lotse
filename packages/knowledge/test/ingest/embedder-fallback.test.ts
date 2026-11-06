import { embeddingDimensions } from "@lotse/db/schema";
import { describe, expect, it, vi } from "vitest";
import {
  createLexicalEmbedder,
  type Embedder,
  LEXICAL_ONLY_MODEL,
  resolveEmbedder,
  vectorSchema,
} from "../../src/ingest/embed.ts";

const working: Embedder = Object.assign(
  async (texts: string[]) =>
    texts.map(() => Array.from({ length: embeddingDimensions }, () => 0.5)),
  { identity: Object.freeze({ model: "real-model", dimensions: embeddingDimensions }) },
);

describe("embedding fallback for ingestion", () => {
  it("keeps a working provider", async () => {
    const warn = vi.fn();
    expect(await resolveEmbedder({}, { create: () => working, warn })).toBe(working);
    expect(warn).not.toHaveBeenCalled();
  });

  it("indexes lexical-only when the provider rejects embeddings, logging only the status", async () => {
    const warn = vi.fn();
    const failing = Object.assign(
      async () => {
        throw Object.assign(new Error("secret response"), { statusCode: 404 });
      },
      { identity: working.identity },
    );
    const embedder = await resolveEmbedder({}, { create: () => failing, warn });
    expect(embedder.identity).toEqual({
      model: LEXICAL_ONLY_MODEL,
      dimensions: embeddingDimensions,
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith("PROVIDER_404");
    const vectors = await embedder(["a", "b"]);
    // Placeholders still satisfy the NOT NULL, non-zero vector column.
    expect(vectors.map((vector) => vectorSchema.safeParse(vector).success)).toEqual([true, true]);
  });

  it("falls back when configuration is missing or embeddings are switched off", async () => {
    const warn = vi.fn();
    expect((await resolveEmbedder({}, { warn })).identity.model).toBe(LEXICAL_ONLY_MODEL);
    expect(warn).toHaveBeenLastCalledWith("PROVIDER_UNAVAILABLE");
    expect((await resolveEmbedder({ LOTSE_EMBEDDINGS: "off" }, { warn })).identity.model).toBe(
      LEXICAL_ONLY_MODEL,
    );
    expect(warn).toHaveBeenLastCalledWith("EMBEDDINGS_DISABLED");
    expect(createLexicalEmbedder().identity.dimensions).toBe(embeddingDimensions);
  });
});
