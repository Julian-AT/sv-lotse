import { z } from "zod";
import denyListData from "../data/deny-list.json" with { type: "json" };

const patternSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((pattern) => {
    try {
      new RegExp(pattern, "iu");
      return true;
    } catch {
      return false;
    }
  }, "Invalid label pattern");

export const DenyListSchema = z.strictObject({
  roles: z.array(z.string().min(1)),
  inputTypes: z.array(z.string().min(1)),
  credentialAutocompleteTokens: z.array(z.string().min(1)).optional(),
  labelPatterns: z.array(patternSchema),
});
export type DenyList = z.infer<typeof DenyListSchema>;
export const defaultDenyList: DenyList = DenyListSchema.parse(denyListData);

export function isCredentialControl(
  control: { inputType: string; autocomplete?: string | null },
  list: DenyList,
): boolean {
  const tokens = (control.autocomplete ?? "").toLowerCase().split(/\s+/u);
  return (
    control.inputType.toLowerCase() === "password" ||
    (list.credentialAutocompleteTokens ?? []).some((token) => tokens.includes(token.toLowerCase()))
  );
}

export function isDeniedControl(
  control: { role: string; inputType: string; label: string; autocomplete?: string | null },
  list: DenyList,
): boolean {
  return (
    isCredentialControl(control, list) ||
    list.roles.includes(control.role.toLowerCase()) ||
    list.inputTypes.includes(control.inputType.toLowerCase()) ||
    list.labelPatterns.some((pattern) => new RegExp(pattern, "iu").test(control.label))
  );
}

export const GuideConfigurationSchema = z.strictObject({
  allowlist: z.array(
    z.string().refine((origin) => {
      try {
        const url = new URL(origin);
        return ["http:", "https:"].includes(url.protocol) && url.origin === origin;
      } catch {
        return false;
      }
    }, "Allowlist entries must be exact HTTP(S) origins"),
  ),
  denyList: DenyListSchema,
  ghostPreview: z.boolean(),
});
