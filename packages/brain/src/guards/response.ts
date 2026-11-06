import { generateText } from "ai";
import { z } from "zod";
import type { BrainConfig } from "../config/index.ts";
import { createModelRouter } from "../models/index.ts";
import {
  type CitedClaim,
  CitedClaimSchema,
  createSupportVerifier,
  type RetrievedPassage,
  RetrievedPassageSchema,
  type SupportVerifier,
  verifyCitation,
} from "./citations.ts";
import {
  type BoundaryClassification,
  type BoundaryClassifier,
  createBoundaryClassifier,
  guardAbortSignal,
} from "./classifier.ts";
import { GUARD_CONFIG } from "./config.ts";
import { guardCopy, guardLocale } from "./copy.ts";
import { boundaryData } from "./data.ts";
import { extractCitedClaims, hasUnverifiedReferences } from "./references.ts";
import { ADMINISTRATIVE_REPAIR_PROMPT } from "./repair.ts";
import { medicalJudgmentRequested } from "./request.ts";
import { checkBoundaryRules } from "./rules.ts";
import { boundaryTaskText } from "./safety-net.ts";
import { untrustedSourceText } from "./source.ts";

export interface ResponseGuardInput {
  text: string;
  userText?: string | undefined;
  language?: string | undefined;
  passages?: readonly RetrievedPassage[] | undefined;
  claims?: readonly CitedClaim[] | undefined;
  administrativeOnly?: boolean | undefined;
  signal?: AbortSignal | undefined;
  untrustedContent?: { kind: "document" | "page"; text: string } | undefined;
}
export interface GuardedResponse {
  text: string;
  disposition: "allow" | "handoff" | "unknown" | "rewrite";
  reason: "allowed" | "rule" | "classifier" | "citation" | "unavailable" | "limit";
  classification?: BoundaryClassification;
}
export interface ResponseGuardDependencies {
  classify: BoundaryClassifier;
  supports: SupportVerifier;
}

/** Nothing is returned for display until rules, citations and the classifier have completed. */
export async function guardResponse(
  input: ResponseGuardInput,
  dependencies: ResponseGuardDependencies,
): Promise<GuardedResponse> {
  input.signal?.throwIfAborted();
  const text = z.string().parse(input.text);
  const copy = guardCopy[guardLocale(input.language)];
  const handoff = (reason: GuardedResponse["reason"]): GuardedResponse => ({
    text: copy.handoff,
    disposition: "handoff",
    reason,
  });
  const unknown = (reason: GuardedResponse["reason"]): GuardedResponse => ({
    text: copy.unknown,
    disposition: "unknown",
    reason,
  });
  if (text.length > GUARD_CONFIG.maxResponseCharacters) return handoff("limit");
  const passages = z.array(RetrievedPassageSchema).parse(input.passages ?? []);
  const claims = z.array(CitedClaimSchema).parse(input.claims ?? []);
  let ruleText = text;
  const verifiedQuotes: string[] = [];
  try {
    if (claims.some((claim) => !text.includes(claim.text))) return unknown("citation");
    // Every claim must verify; checking them concurrently only removes serial latency.
    const checks = await Promise.all(
      claims.map((claim) => verifyCitation(claim, passages, dependencies.supports, input.signal)),
    );
    if (checks.some((check) => !check.valid)) {
      console.info(
        JSON.stringify({ event: "citation_check", reasons: checks.map((check) => check.reason) }),
      );
      return unknown("citation");
    }
    for (const claim of claims) {
      // Only attributed, delimited verbatim quotes are exempt from speech-act rules.
      for (const citation of claim.citations) {
        for (const [left, right] of [
          ["„", "“"],
          ["“", "”"],
          ['"', '"'],
          ["«", "»"],
        ]) {
          const quoted = `${left}${citation.quote}${right}`;
          if (claim.text.includes(quoted)) {
            ruleText = ruleText.replace(quoted, "[verified documented quote]");
            verifiedQuotes.push(citation.quote);
          }
        }
      }
    }
    if (hasUnverifiedReferences(text, claims)) {
      return unknown("citation");
    }
    const violations = checkBoundaryRules(ruleText);
    if (violations.some((violation) => violation.category === "injection")) return unknown("rule");
    if (violations.length > 0) return handoff("rule");
    const classification = await dependencies.classify(text, {
      signal: input.signal,
      verifiedQuotes,
      administrativeOnly: input.administrativeOnly,
      userText: input.userText ? boundaryTaskText(input.userText) : undefined,
      untrustedContent: input.untrustedContent
        ? { ...input.untrustedContent, text: untrustedSourceText(input.untrustedContent.text) }
        : undefined,
    });
    if (classification.violation || classification.score >= GUARD_CONFIG.boundaryThreshold) {
      return classification.category === "injection" ||
        (Boolean(input.userText) && classification.responseKind === "administrative")
        ? unknown("classifier")
        : handoff("classifier");
    }
    if (classification.responseKind === "medical_handoff") return handoff("classifier");
    if (input.userText && (!classification.taskAddressed || text === copy.handoff)) {
      return unknown("classifier");
    }
    return { text, disposition: "allow", reason: "allowed", classification };
  } catch {
    input.signal?.throwIfAborted();
    return handoff("unavailable");
  }
}
export type ResponseGuard = ((input: ResponseGuardInput) => Promise<GuardedResponse>) & {
  /** Starts the request-only medical check early; the guard reuses its result for this text. */
  prewarm: (userText: string, signal?: AbortSignal) => void;
};
export function createResponseGuard(
  config: BrainConfig,
  overrides?: { supports?: SupportVerifier },
): ResponseGuard {
  const classify = createBoundaryClassifier(config);
  const supports = overrides?.supports ?? createSupportVerifier(config);
  const requests = new Map<string, Promise<boolean>>();
  const medicalRequest = (userText: string, signal?: AbortSignal): Promise<boolean> => {
    const task = boundaryTaskText(userText);
    let pending = requests.get(task);
    if (!pending) {
      pending = medicalJudgmentRequested(config, task, signal);
      requests.set(task, pending);
      // A failed check is never cached; the next caller asks again.
      pending.catch(() => requests.delete(task));
    }
    return pending;
  };
  const guard = async (input: ResponseGuardInput): Promise<GuardedResponse> => {
    const copy = guardCopy[guardLocale(input.language)];
    if (input.userText) {
      try {
        if (await medicalRequest(input.userText, input.signal))
          return { text: copy.handoff, disposition: "handoff", reason: "classifier" };
      } catch {
        input.signal?.throwIfAborted();
        return { text: copy.handoff, disposition: "handoff", reason: "unavailable" };
      }
    }
    const dependencies: ResponseGuardDependencies = {
      supports,
      classify: async (text, context) => {
        const result = await classify(text, context);
        // The request-only call established intent without seeing potentially unsafe output.
        return input.userText ? { ...result, responseKind: "administrative" } : result;
      },
    };
    const check = async (candidate: ResponseGuardInput): Promise<GuardedResponse> => {
      if (
        input.userText &&
        boundaryData.administrativeDisclaimers.some((pattern) => pattern.test(candidate.text))
      )
        return { text: copy.unknown, disposition: "unknown", reason: "classifier" };
      const result = await guardResponse(candidate, dependencies);
      return input.userText && result.disposition === "handoff" && result.reason === "rule"
        ? { text: copy.unknown, disposition: "unknown", reason: "rule" }
        : result;
    };
    let guarded = await check(input);
    if (!input.userText || guarded.disposition !== "unknown") return guarded;
    // Reason codes only: the rejected text never reaches process logs.
    console.info(
      JSON.stringify({
        event: "response_guard_repair",
        reason: guarded.reason,
        claims: input.claims?.length ?? 0,
      }),
    );
    for (let attempt = 0; attempt < GUARD_CONFIG.repairAttempts; attempt++) {
      try {
        const result = await generateText({
          model: createModelRouter(config).modelFor("orchestrator"),
          instructions: ADMINISTRATIVE_REPAIR_PROMPT,
          prompt: JSON.stringify({
            userTask: boundaryTaskText(input.userText),
            language: input.language,
            passages: input.passages ?? [],
            untrustedContent: input.untrustedContent
              ? {
                  ...input.untrustedContent,
                  text: untrustedSourceText(input.untrustedContent.text),
                }
              : null,
          }),
          maxRetries: 0,
          maxOutputTokens: GUARD_CONFIG.maxOutputTokens,
          abortSignal: guardAbortSignal(input.signal),
          telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
        });
        // Repair is a new, untrusted candidate. It must pass the same complete gate.
        guarded = await check({
          ...input,
          text: result.text,
          claims: extractCitedClaims(result.text, input.passages ?? []),
        });
        if (guarded.disposition === "allow") return { ...guarded, disposition: "rewrite" };
        if (guarded.disposition !== "unknown") return guarded;
      } catch {
        input.signal?.throwIfAborted();
        return guarded;
      }
    }
    return guarded;
  };
  return Object.assign(guard, {
    prewarm: (userText: string, signal?: AbortSignal): void => {
      if (userText.trim()) medicalRequest(userText, signal).catch(() => {});
    },
  });
}
