import { ContextCapsuleSchema } from "@lotse/protocol";
import {
  type CapsulePage,
  createGuide,
  type Guide,
  type GuideOptions,
  toCapsulePage,
} from "../src/index.ts";

declare global {
  interface Window {
    guide: Guide;
    guideOptions?: Partial<Omit<GuideOptions, "document">>;
    capsuleIsValid: () => boolean;
    capsulePage: () => CapsulePage;
    inspectOverlay: () => {
      foundNodes: number;
      firstNode: Element | null;
      shadow: ShadowRoot | null;
    };
    attackOverlay: (selector: string, declarations: string) => void;
    observed: { type: string; value: string; data: string | null; time: number; key: string }[];
  }
}
window.guide = createGuide({ allowlist: [location.origin], ...window.guideOptions });
window.capsulePage = () => toCapsulePage(window.guide.snapshot());
window.capsuleIsValid = () =>
  ContextCapsuleSchema.shape.page.safeParse(window.capsulePage()).success;
