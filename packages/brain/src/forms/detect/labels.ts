import { formDetectionVocabulary } from "@lotse/knowledge/form-detection";
import type { Candidate } from "./candidates.ts";
import { DETECTION_CONFIG } from "./config.ts";
import type { FieldBox } from "./schema.ts";
import type { TextRun } from "./text.ts";

const options = formDetectionVocabulary.contextualOptions.map(
  (pattern) => new RegExp(pattern, "iu"),
);
const rules = formDetectionVocabulary.labelRules.map((rule) => ({
  ...rule,
  expression: new RegExp(rule.pattern, "iu"),
}));

export function cleanLabel(label: string): string {
  let result = label
    .normalize("NFKC")
    .replace(/(?:\p{L} ){3,}\p{L}/gu, (word) => word.replaceAll(" ", ""))
    .replace(/\s*\(\s*\d+\s*\)/gu, "")
    .replace(/,\s*/gu, ", ")
    .replace(/\s+/gu, " ")
    .replace(/[\s:]+$/u, "")
    .replace(/^\d+[.)]\s*/u, "")
    .trim();
  // Parenthetical instructions are separate help text, not the field's printed name.
  result = result.replace(/\s+\([^)]{40,}\)(?:\s.*)?$/u, "");
  for (const rule of rules) result = result.replace(rule.expression, rule.replacement);
  return result;
}

export function joinLabel(runs: readonly TextRun[]): string {
  return cleanLabel(
    [...runs]
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
      .filter((run) => !/^\([^)]{40,}\)$/u.test(run.text))
      .map((run) => run.text)
      .join("\n")
      .replace(/(?<=\p{L})-\n(?!(?:und|oder|bzw)\b)(?=\p{Ll})/gu, ""),
  );
}

/** Repeated answer rows inherit the printed header from the same bounded column. */
export function columnLabel(
  candidate: Candidate,
  cells: readonly Candidate[],
  runs: readonly TextRun[],
): string | undefined {
  if (candidate.checkbox) return undefined;
  const box = candidate.box;
  const printed = runs
    .filter(
      (run) =>
        /[\p{L}]/u.test(run.text) &&
        !ignoredLabel(run.text) &&
        !cells.some(
          (cell) =>
            cell.checkbox &&
            Math.abs(cell.box.y - run.box.y) < 10 &&
            run.box.x - cell.box.x - cell.box.width >= -2 &&
            run.box.x - cell.box.x - cell.box.width < 55,
        ) &&
        run.box.x >= box.x - 1 &&
        run.box.x + run.box.width <= box.x + box.width + 1 &&
        run.box.y + run.box.height <= box.y + 1 &&
        box.y - run.box.y < DETECTION_CONFIG.maximumColumnHeaderDistance,
    )
    .sort((a, b) => b.box.y - a.box.y);
  const last = printed[0];
  if (!last) return undefined;
  const group = [last];
  for (const run of printed.slice(1)) {
    const previous = group.at(-1);
    if (!previous || previous.box.y - run.box.y - run.box.height > DETECTION_CONFIG.labelWrapGap)
      break;
    group.push(run);
  }
  return joinLabel(group) || undefined;
}

const contextRules = formDetectionVocabulary.contextRules.map((rule) => ({
  ...rule,
  expression: new RegExp(rule.pattern, "iu"),
  labels: rule.labels.map((pattern) => new RegExp(pattern, "iu")),
}));
const checkboxRules = formDetectionVocabulary.checkboxRules.map((rule) => ({
  ...rule,
  expression: new RegExp(rule.pattern, "iu"),
}));
export function ignoredLabel(label: string): boolean {
  return formDetectionVocabulary.ignoredLabels.some((pattern) =>
    new RegExp(pattern, "iu").test(label),
  );
}

export function contextualLabel(
  label: string,
  box: FieldBox,
  runs: readonly TextRun[],
  checkbox = false,
): string {
  let cleaned = cleanLabel(
    checkbox
      ? label.replace(/_{3,}.*$/u, "")
      : formDetectionVocabulary.inputRules.reduce(
          (value, rule) => value.replace(new RegExp(rule.pattern, "iu"), rule.replacement),
          label,
        ),
  );
  if (checkbox)
    for (const rule of checkboxRules) cleaned = cleaned.replace(rule.expression, rule.replacement);
  const contexts = contextGroups(runs).filter(
    (run) =>
      run.box.y <= box.y + 3 && box.y - run.box.y < DETECTION_CONFIG.maximumColumnHeaderDistance,
  );
  const matched = contexts
    .flatMap((run) =>
      contextRules.flatMap((rule) => {
        if (
          box.y - run.box.y > rule.distance ||
          !rule.labels.some((pattern) => pattern.test(cleaned))
        )
          return [];
        const match = rule.expression.exec(run.text);
        return match
          ? [
              {
                y: run.box.y,
                distance: Math.abs(run.box.x - box.x),
                text: match[0].replace(rule.expression, rule.replacement),
              },
            ]
          : [];
      }),
    )
    .sort((a, b) => b.y - a.y || a.distance - b.distance || b.text.length - a.text.length)[0];
  if (matched) return `${matched.text} – ${cleaned}`;
  if (!checkbox || !options.some((pattern) => pattern.test(cleaned))) return cleaned;
  const left = runs.filter(
    (run) =>
      /[?:]\s*$/u.test(run.text) &&
      run.box.x + run.box.width < box.x &&
      Math.abs(run.box.y + run.box.height / 2 - box.y - box.height / 2) < 6,
  );
  const question = joinLabel(left);
  return question ? `${question} – ${cleaned}` : cleaned;
}

function contextGroups(runs: readonly TextRun[]): TextRun[] {
  return runs.map((first) => {
    const group = [first];
    for (const next of runs
      .filter((run) => run.box.y > first.box.y + 2)
      .sort((a, b) => a.box.y - b.box.y)) {
      const previous = group.at(-1);
      if (
        !previous ||
        next.box.y - previous.box.y - previous.box.height > DETECTION_CONFIG.labelWrapGap
      )
        break;
      if (Math.abs(next.box.x - first.box.x) > 15) continue;
      group.push(next);
      if (group.length === 4) break;
    }
    return {
      ...first,
      text: group
        .map((run) => run.text)
        .join(" ")
        .replace(/(?<=\p{L})-\s+(?!(?:und|oder|bzw)\b)(?=\p{Ll})/gu, ""),
    };
  });
}
