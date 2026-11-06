import { boundaryData } from "./data.ts";

/** Keep a contiguous original prefix, so every visible quote remains verbatim in the source. */
export function untrustedSourceText(text: string): string {
  const offsets = boundaryData.injectionMarkers.flatMap((marker) => {
    const match = marker.exec(text);
    return match ? [match.index] : [];
  });
  return offsets.length ? text.slice(0, Math.min(...offsets)).trimEnd() : text;
}
