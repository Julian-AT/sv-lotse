import type { Candidate } from "./candidates.ts";
import { DETECTION_CONFIG } from "./config.ts";
import { cleanLabel, ignoredLabel, joinLabel } from "./labels.ts";
import type { FieldBox } from "./schema.ts";
import { associateLabel, inferType, type TextRun } from "./text.ts";

/** Join PDF operator fragments, stopping at answer boxes and separate printed columns. */
export function labelLines(runs: readonly TextRun[], cells: readonly Candidate[]): TextRun[] {
  const lines: TextRun[] = [];
  for (const run of runs
    .map(labelRun)
    .filter((run): run is TextRun => run !== undefined)
    .filter((run) => !run.square && !/[\p{Cc}]/u.test(run.text))
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const previous = lines.findLast(
      (line) =>
        Math.abs(line.box.y - run.box.y) < 2 &&
        run.box.x >= line.box.x + line.box.width - 1 &&
        run.box.x - line.box.x - line.box.width <=
          (hasCheckboxLabel(line, cells)
            ? DETECTION_CONFIG.shortLabelGap
            : DETECTION_CONFIG.labelLineGap) &&
        !cells.some(
          (cell) =>
            cell.box.x > line.box.x + line.box.width + 1 &&
            cell.box.x < run.box.x &&
            cell.box.y <= run.box.y + run.box.height + 20 &&
            cell.box.y + cell.box.height >= run.box.y - 15,
        ) &&
        !cells.some(
          (cell) =>
            cell.checkbox &&
            cell.box.x >= line.box.x + line.box.width - 1 &&
            cell.box.x < run.box.x &&
            Math.abs(cell.box.y - run.box.y) < cell.box.height,
        ),
    );
    if (previous) {
      previous.text += ` ${run.text}`;
      previous.box.width = run.box.x + run.box.width - previous.box.x;
      previous.box.height = Math.max(
        previous.box.height,
        run.box.y + run.box.height - previous.box.y,
      );
    } else lines.push({ ...run, box: { ...run.box } });
  }
  return lines;
}

/** Same-row captions beat inherited column headers; baselines also allow captions below. */
export function directLabel(
  box: FieldBox,
  runs: readonly TextRun[],
  checkbox: boolean,
  cells: readonly Candidate[] = [],
): string | undefined {
  if (checkbox) {
    const right = runs
      .filter(
        (run) =>
          /[\p{L}]/u.test(run.text) &&
          run.box.x >= box.x + box.width - 2 &&
          run.box.x - box.x - box.width < 55 &&
          Math.abs(run.box.y + run.box.height / 2 - box.y - box.height / 2) < 7,
      )
      .sort((a, b) => a.box.x - b.box.x)[0];
    return right ? wrappedLabel(right, runs, box, true, cells) : undefined;
  }
  const left = runs
    .filter(
      (run) =>
        /[\p{L}]/u.test(run.text) &&
        !ignoredLabel(run.text) &&
        run.box.x + run.box.width <= box.x + 2 &&
        box.x - run.box.x - run.box.width < (/[?:]$/u.test(run.text) ? 150 : 50) &&
        Math.abs(run.box.y + run.box.height / 2 - box.y - box.height / 2) < 6 &&
        (box.x - run.box.x - run.box.width < 5 ||
          !cells.some(
            (cell) =>
              cell.checkbox &&
              Math.abs(cell.box.y - run.box.y) < 10 &&
              run.box.x - cell.box.x - cell.box.width >= -2 &&
              run.box.x - cell.box.x - cell.box.width < 55,
          )),
    )
    .sort((a, b) => b.box.x + b.box.width - a.box.x - a.box.width)[0];
  if (left) return wrappedLabel(left, runs, box, false, cells);
  const below = runs
    .filter(
      (run) =>
        run.box.y >= box.y + box.height - 2 &&
        box.height <= DETECTION_CONFIG.writingHeight + 1 &&
        run.box.y - box.y - box.height < 16 &&
        Math.abs(run.box.x - box.x) < 8 &&
        ["date", "signature"].includes(inferType(run.text)),
    )
    .sort((a, b) => a.box.y - b.box.y)[0];
  return below?.text;
}

export function nearbyLabel(
  box: FieldBox,
  runs: readonly TextRun[],
  checkbox: boolean,
  cells: readonly Candidate[] = [],
): string | undefined {
  const label = associateLabel(box, runs, checkbox);
  const selected = runs.find((run) => run.text === label);
  return selected ? wrappedLabel(selected, runs, box, checkbox, cells) : label;
}

function wrappedLabel(
  first: TextRun,
  runs: readonly TextRun[],
  box: FieldBox,
  checkbox: boolean,
  cells: readonly Candidate[],
): string {
  const group = [first];
  for (const run of runs
    .filter((run) => run.box.y > first.box.y + 2)
    .sort((a, b) => a.box.y - b.box.y)) {
    const previous = group.at(-1);
    if (
      !previous ||
      run.box.y - previous.box.y - previous.box.height > DETECTION_CONFIG.labelWrapGap
    )
      break;
    if (outsideCaptionColumn(first, run, box, checkbox)) continue;
    if (checkbox && run.box.y > box.y + box.height + 15) break;
    if (checkbox && nextCheckbox(box, run, cells)) break;
    group.push(run);
    if (group.length === 4) break;
  }
  // A true line-end hyphen joins a word; suspended compounds retain their hyphen.
  const text = group
    .map((run) => run.text)
    .join("\n")
    .replace(/(?<=\p{L})-\n(?!(?:und|oder|bzw)\b)(?=\p{Ll})/gu, "");
  return cleanLabel(text || joinLabel(group));
}

function nextCheckbox(box: FieldBox, run: TextRun, cells: readonly Candidate[]): boolean {
  return cells.some(
    (cell) =>
      cell.checkbox &&
      cell.box.y > box.y + 2 &&
      cell.box.y <= run.box.y + run.box.height &&
      cell.box.x >= box.x - 2 &&
      cell.box.x < run.box.x,
  );
}

function labelRun(run: TextRun): TextRun | undefined {
  const index = run.text.search(/_{3,}|\.{5,}|…{2,}/u);
  if (index < 0) return run;
  const text = run.text.slice(0, index).trim();
  if (!text) return undefined;
  const width = run.advances?.[text.length] ?? (run.box.width * text.length) / run.text.length;
  return { ...run, text, box: { ...run.box, width } };
}

function hasCheckboxLabel(run: TextRun, cells: readonly Candidate[]): boolean {
  return cells.some(
    (cell) =>
      cell.checkbox &&
      Math.abs(cell.box.y - run.box.y) < 10 &&
      run.box.x - cell.box.x - cell.box.width >= -2 &&
      run.box.x - cell.box.x - cell.box.width < 55,
  );
}

function outsideCaptionColumn(
  first: TextRun,
  run: TextRun,
  box: FieldBox,
  checkbox: boolean,
): boolean {
  return (
    Math.abs(run.box.x - first.box.x) > 12 || (!checkbox && run.box.y + run.box.height > box.y + 2)
  );
}
