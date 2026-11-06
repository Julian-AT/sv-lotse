import { findForms } from "../../../forms/acquire/find.ts";
import { acquireForm } from "../../../forms/acquire/index.ts";
import { commitFormGroup, prefillForm } from "../../../forms/instances/index.ts";
import { buildFormPackage } from "../../../forms/output/index.ts";
import {
  analyzeTemplate,
  getFormSchema,
  getTemplate,
  templateForUse,
} from "../../../forms/registry/index.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "form.find": async (raw, _context, options) =>
      findForms(requireDatabase(deps), raw, options.abortSignal),
    "form.acquire": async (raw, _context, options) => {
      const input = contracts["form.acquire"].input.parse(raw);
      const template = await acquireForm(requireDatabase(deps), input.url, options.abortSignal);
      return {
        id: template.id,
        format: template.format,
        pages: template.pages,
        hash: template.hash,
        retrievedAt: template.retrievedAt.toISOString(),
        status: template.status,
      };
    },
    "form.analyze": async (raw, _context, options) => {
      const input = contracts["form.analyze"].input.parse(raw);
      const db = requireDatabase(deps);
      return analyzeTemplate(db, await getTemplate(db, input.templateId), options.abortSignal);
    },
    "form.getSchema": async (raw, _context, options) => {
      const input = contracts["form.getSchema"].input.parse(raw);
      const db = requireDatabase(deps);
      return getFormSchema(
        db,
        await templateForUse(db, input.templateId, options.abortSignal),
        options.abortSignal,
      );
    },
    "form.prefill": async (raw, context, options) =>
      prefillForm(requireDatabase(deps), raw, context, options.abortSignal),
    "form.commitGroup": async (raw, context, options) =>
      commitFormGroup(requireDatabase(deps), raw, context, options.toolCallId),
    "package.build": async (raw, context) =>
      buildFormPackage(requireDatabase(deps), raw, context, deps.analytics),
  };
}
