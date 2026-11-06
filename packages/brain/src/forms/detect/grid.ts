import type { Candidate } from "./candidates.ts";
import { DETECTION_CONFIG } from "./config.ts";
import { joinLabel } from "./labels.ts";
import type { FieldBox } from "./schema.ts";
import type { TextRun } from "./text.ts";

export interface Rule {
  start: number;
  end: number;
  at: number;
}
const tolerance = DETECTION_CONFIG.lineTolerance;

export function mergeRules(rules: readonly Rule[]): Rule[] {
  const result: Rule[] = [];
  for (const rule of [...rules].sort((a, b) => a.at - b.at || a.start - b.start)) {
    const previous = result.find(
      (item) =>
        Math.abs(item.at - rule.at) <= tolerance &&
        rule.start <= item.end + tolerance &&
        rule.end >= item.start - tolerance,
    );
    if (previous) {
      previous.start = Math.min(previous.start, rule.start);
      previous.end = Math.max(previous.end, rule.end);
    } else result.push({ ...rule });
  }
  return result;
}

/** Recover cells whose sides are separate strokes or filled border strips. */
export function gridCandidates(
  horizontal: readonly Rule[],
  vertical: readonly Rule[],
  page: number,
): Candidate[] {
  const rows = mergeRules(horizontal);
  const columns = mergeRules(vertical);
  const result: Candidate[] = [];
  for (const top of rows) {
    const bottoms = rows
      .filter(
        (bottom) =>
          bottom.at - top.at >= DETECTION_CONFIG.minimumCellHeight &&
          bottom.at - top.at <= DETECTION_CONFIG.maximumCellHeight,
      )
      .sort((a, b) => a.at - b.at);
    for (const bottom of bottoms) {
      result.push(...cellsBetween(top, bottom, rows, columns, page));
    }
  }
  return result;
}

/** Printed labels inside a cell occupy its top; only the remaining writing space is fillable. */
export function answerCandidate(
  candidate: Candidate,
  runs: readonly TextRun[],
): Candidate | undefined {
  if (candidate.checkbox || candidate.method === "text" || candidate.box.width < 25)
    return candidate;
  const box = candidate.box;
  const rule = refineRule(candidate, runs);
  if (rule.handled) return rule.candidate;
  const inside = runs.filter(
    (run) =>
      /[\p{L}\p{N}]/u.test(run.text) &&
      run.box.x >= box.x - 1 &&
      run.box.x + run.box.width <= box.x + box.width + 1 &&
      run.box.y >= box.y - 1 &&
      run.box.y + run.box.height <= box.y + box.height + 1,
  );
  if (inside.length === 0) return candidate;
  const marker = inside.length === 1 ? inside[0] : undefined;
  if (marker && /^[a-z]\)$/iu.test(marker.text)) {
    const label = subcellLabel(marker, box, runs);
    if (label) return { ...candidate, label };
  }
  if (
    inside.every((run) => run.box.x > box.x + box.width * DETECTION_CONFIG.trailingUnitPosition)
  ) {
    const right = Math.min(...inside.map((run) => run.box.x)) - 2;
    return { ...candidate, box: { ...box, width: right - box.x } };
  }
  const bottom = Math.max(...inside.map((run) => run.box.y + run.box.height));
  const top = Math.min(...inside.map((run) => run.box.y));
  if (top - box.y > box.height / 2) {
    return {
      ...candidate,
      box: { ...box, height: top - box.y - DETECTION_CONFIG.labelInset },
      label: inside.map((run) => run.text).join(" "),
    };
  }
  if (bottom > box.y + box.height - DETECTION_CONFIG.minimumAnswerHeight) return undefined;
  const y = bottom + DETECTION_CONFIG.labelInset;
  if (box.y + box.height - y < DETECTION_CONFIG.minimumAnswerHeight) return undefined;
  return {
    ...candidate,
    box: { ...box, y, height: box.y + box.height - y },
    label: inside
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
      .map((run) => run.text)
      .join(" "),
  };
}

function refineRule(
  candidate: Candidate,
  runs: readonly TextRun[],
): { handled: boolean; candidate?: Candidate } {
  if (candidate.confidence !== 0.6) return { handled: false };
  const box = candidate.box;
  if (
    runs.some(
      (run) =>
        /[\p{L}]/u.test(run.text) &&
        Math.abs(run.box.y + run.box.height - box.y - box.height) < 3 &&
        Math.max(
          0,
          Math.min(box.x + box.width, run.box.x + run.box.width) - Math.max(box.x, run.box.x),
        ) /
          box.width >=
          DETECTION_CONFIG.printedRuleCoverage,
    )
  )
    return { handled: true };
  const left = runs.find(
    (run) =>
      /[\p{L}]/u.test(run.text) &&
      Math.abs(run.box.y + run.box.height - box.y - box.height) < 2 &&
      box.x - run.box.x - run.box.width >= -2 &&
      box.x - run.box.x - run.box.width < 8,
  );
  if (left) {
    const height = Math.min(box.height, left.box.height * DETECTION_CONFIG.inlineWritingScale);
    return {
      handled: true,
      candidate: {
        ...candidate,
        box: { ...box, y: box.y + box.height - height, height },
        label: left.text,
      },
    };
  }
  return { handled: false };
}

function subcellLabel(
  marker: TextRun,
  box: FieldBox,
  runs: readonly TextRun[],
): string | undefined {
  const heading = runs
    .filter(
      (run) =>
        run.text.startsWith(marker.text) &&
        run.text !== marker.text &&
        run.box.y < box.y &&
        box.y - run.box.y < DETECTION_CONFIG.maximumColumnHeaderDistance &&
        run.box.x >= box.x - 2 &&
        run.box.x + run.box.width <= box.x + box.width + 2,
    )
    .sort((a, b) => b.box.y - a.box.y)[0];
  if (!heading) return undefined;
  const group = [heading];
  for (const run of runs
    .filter(
      (run) =>
        run.box.y > heading.box.y + 2 &&
        run.box.y < box.y &&
        run.box.x >= box.x - 2 &&
        run.box.x + run.box.width <= box.x + box.width + 2,
    )
    .sort((a, b) => a.box.y - b.box.y)) {
    const previous = group.at(-1);
    if (
      !previous ||
      run.box.y - previous.box.y - previous.box.height > DETECTION_CONFIG.labelWrapGap ||
      /^[a-z]\)/iu.test(run.text)
    )
      break;
    if (!/^\*?\)$/u.test(run.text)) group.push(run);
  }
  return joinLabel(group).replace(/^[a-z]\)\s*/iu, "");
}

export function containsBox(outer: FieldBox, inner: FieldBox): boolean {
  return (
    outer.page === inner.page &&
    inner.x >= outer.x - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/** A single caption spanning a divider identifies one logical answer area. */
export function mergeCaptionCells(
  candidates: readonly Candidate[],
  runs: readonly TextRun[],
): Candidate[] {
  const result: Candidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const previous = result.find(
      (other) =>
        !other.checkbox &&
        !candidate.checkbox &&
        other.box.width <= DETECTION_CONFIG.maximumCaptionCellWidth &&
        candidate.box.width <= DETECTION_CONFIG.maximumCaptionCellWidth &&
        Math.abs(other.box.y - candidate.box.y) < 1 &&
        Math.abs(other.box.height - candidate.box.height) < 1 &&
        Math.abs(other.box.x + other.box.width - candidate.box.x) < 2 &&
        runs.some(
          (run) =>
            run.box.y + run.box.height <= candidate.box.y + 1 &&
            candidate.box.y - run.box.y - run.box.height < 15 &&
            run.box.x < candidate.box.x &&
            run.box.x + run.box.width > candidate.box.x &&
            run.box.x >= other.box.x - 2 &&
            run.box.x + run.box.width <= candidate.box.x + candidate.box.width + 2,
        ),
    );
    if (previous) previous.box.width = candidate.box.x + candidate.box.width - previous.box.x;
    else result.push({ ...candidate, box: { ...candidate.box } });
  }
  return result;
}

/** Distinct labels in an undivided row identify separate writing areas. */
export function splitLabelledCells(
  candidates: readonly Candidate[],
  runs: readonly TextRun[],
): Candidate[] {
  return candidates.flatMap((candidate) => {
    if (candidate.checkbox || candidate.method !== "vector") return [candidate];
    const box = candidate.box;
    const labels = runs
      .filter(
        (run) =>
          /[\p{L}]/u.test(run.text) &&
          run.box.x >= box.x &&
          run.box.x + run.box.width <= box.x + box.width &&
          run.box.y >= box.y - 1 &&
          run.box.y < box.y + DETECTION_CONFIG.labelRowHeight,
      )
      .sort((a, b) => a.box.x - b.box.x);
    const first = labels[0];
    if (!first) return [candidate];
    const starts = [
      box.x,
      ...candidates
        .filter(
          (header) =>
            Math.abs(header.box.y + header.box.height - box.y) < 2 &&
            Math.abs(header.box.x + header.box.width - box.x - box.width) < 3 &&
            header.box.height <= DETECTION_CONFIG.labelRowHeight * 2 &&
            runs.some((run) => /[\p{L}]/u.test(run.text) && containsBox(header.box, run.box)) &&
            header.box.x > box.x + 2 &&
            header.box.x < box.x + box.width - 2,
        )
        .map((header) => header.box.x),
    ];
    for (let i = 1; i < labels.length; i++) {
      const previous = labels[i - 1],
        label = labels[i];
      if (
        label &&
        previous &&
        Math.abs(label.box.y - first.box.y) < 3 &&
        label.box.x - previous.box.x - previous.box.width > DETECTION_CONFIG.labelFragmentGap
      )
        starts.push(label.box.x - 2);
    }
    const ordered = [...new Set(starts)].sort((a, b) => a - b);
    return ordered.map((x, index) => ({
      ...candidate,
      box: { ...box, x, width: (ordered[index + 1] ?? box.x + box.width) - x },
    }));
  });
}

function cellsBetween(
  top: Rule,
  bottom: Rule,
  rows: readonly Rule[],
  columns: readonly Rule[],
  page: number,
): Candidate[] {
  const result: Candidate[] = [];
  const left = Math.max(top.start, bottom.start),
    right = Math.min(top.end, bottom.end);
  const sides = columns
    .filter(
      (side) =>
        side.at >= left - tolerance &&
        side.at <= right + tolerance &&
        side.start <= top.at + tolerance &&
        side.end >= bottom.at - tolerance,
    )
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < sides.length; i++) {
    const x = sides[i - 1]?.at,
      end = sides[i]?.at;
    if (x === undefined || end === undefined || end - x < 5) continue;
    // An intervening rule closes this cell sooner, even when a lower row has more columns.
    if (
      rows.some(
        (row) =>
          row.at > top.at + tolerance &&
          row.at < bottom.at - tolerance &&
          row.start <= x + tolerance &&
          row.end >= end - tolerance,
      )
    )
      continue;
    const box = { page, x, y: top.at, width: end - x, height: bottom.at - top.at };
    result.push({
      box,
      checkbox:
        box.width <= 24 &&
        box.height <= 24 &&
        box.width / box.height >= 0.7 &&
        box.width / box.height <= 1.4,
      method: "vector",
      confidence: 0.85,
    });
  }
  return result;
}
