import type { CitedClaim, RetrievedPassage } from "./citations.ts";

/** Recognize supported passage markers, common numeric/UUID citations and source URLs. */
export function citationReferences(text: string): { ids: string[]; urls: string[] } {
  const ids = [
    ...text.matchAll(/\[(?:passage:([^\]]+)|(\d+|[\da-f]{8}-[\da-f-]{27,}))\]/giu),
  ].flatMap((match) => match[1] ?? match[2] ?? []);
  const urls = [...text.matchAll(/https?:\/\/[^\s<>"\])]+/gu)].map((match) =>
    match[0].replace(/[.,;:!?]+$/u, ""),
  );
  return { ids, urls };
}
export function extractCitedClaims(
  text: string,
  passages: readonly RetrievedPassage[],
): CitedClaim[] {
  return text.split(/(?<=[.!?])\s+/u).flatMap((sentence) => {
    const references = citationReferences(sentence);
    const selected = passages.filter(
      (passage) => references.ids.includes(passage.id) || references.urls.includes(passage.url),
    );
    return selected.length
      ? [
          {
            text: sentence,
            citations: selected.map((passage) => ({
              passageId: passage.id,
              url: passage.url,
              quote: passage.text,
            })),
          },
        ]
      : [];
  });
}
export function hasUnverifiedReferences(text: string, claims: readonly CitedClaim[]): boolean {
  const references = citationReferences(text);
  const citations = claims.flatMap((claim) => claim.citations);
  return (
    references.ids.some((id) => !citations.some((citation) => citation.passageId === id)) ||
    references.urls.some((url) => !citations.some((citation) => citation.url === url))
  );
}
