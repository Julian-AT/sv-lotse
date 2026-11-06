import type { Candidate } from "./candidates.ts";
import { DETECTION_CONFIG } from "./config.ts";
import type { TextRun } from "./text.ts";

/** Repeated captions partition a shared table row even without an internal horizontal stroke. */
export function splitRepeatedRows(
  cells: readonly Candidate[],
  runs: readonly TextRun[],
): Candidate[] {
  return cells.flatMap((cell) => {
    if (cell.checkbox || cell.box.height < DETECTION_CONFIG.minimumRepeatedRowHeight) return [cell];
    const box = cell.box;
    const peers = cells.filter(
      (other) => Math.abs(other.box.y - box.y) < 2 && Math.abs(other.box.height - box.height) < 2,
    );
    const left = Math.min(...peers.map((other) => other.box.x));
    const right = Math.max(...peers.map((other) => other.box.x + other.box.width));
    const labels = runs.filter(
      (run) =>
        run.text.length > 10 &&
        /:$/u.test(run.text) &&
        run.box.x >= left &&
        run.box.x + run.box.width <= right &&
        run.box.y >= box.y &&
        run.box.y + run.box.height <= box.y + box.height,
    );
    const breaks = labels
      .filter((run) =>
        labels.some(
          (previous) =>
            previous.text === run.text &&
            Math.abs(previous.box.x - run.box.x) < 2 &&
            run.box.y - previous.box.y > 20,
        ),
      )
      .map((run) => run.box.y - run.box.height * DETECTION_CONFIG.rowCaptionOffset);
    const starts = [box.y, ...new Set(breaks)].sort((a, b) => a - b);
    return starts.map((y, index) => ({
      ...cell,
      box: { ...box, y, height: (starts[index + 1] ?? box.y + box.height) - y },
    }));
  });
}

/** Dense multi-line captions over repeated blank columns are a header band. */
export function printedHeader(
  cell: Candidate,
  cells: readonly Candidate[],
  runs: readonly TextRun[],
): boolean {
  if (cell.checkbox) return false;
  const bottom = cell.box.y + cell.box.height;
  const peers = cells.filter(
    (other) => !other.checkbox && Math.abs(other.box.y + other.box.height - bottom) < 2,
  );
  if (peers.length < DETECTION_CONFIG.minimumHeaderColumns) return false;
  const inside = (other: Candidate): TextRun[] =>
    runs.filter(
      (run) =>
        /[\p{L}]/u.test(run.text) &&
        run.box.x >= other.box.x - 1 &&
        run.box.x + run.box.width <= other.box.x + other.box.width + 1 &&
        run.box.y >= other.box.y - 1 &&
        run.box.y + run.box.height <= bottom + 1,
    );
  const wrapped = peers.filter((other) => {
    const text = inside(other);
    return text.some((run) => text.some((next) => next.box.y - run.box.y > 3));
  });
  return wrapped.length >= DETECTION_CONFIG.minimumWrappedHeaders && inside(cell).length > 0;
}
