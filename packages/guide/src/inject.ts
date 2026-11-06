import { createGuide, toCapsulePage } from "./index.ts";
import { PortalConnectionSchema } from "./portal-contract.ts";
import { connectPortal } from "./portal-runtime.ts";

let active: { channel: string; disconnect: () => void } | undefined;
function activatePortal(input: unknown): () => void {
  const connection = PortalConnectionSchema.parse(input);
  if (active?.channel === connection.channel) return active.disconnect;
  active?.disconnect();
  const disconnect = connectPortal(connection, () => {
    if (active?.channel === connection.channel) active = undefined;
  });
  active = { channel: connection.channel, disconnect };
  return disconnect;
}
const api = Object.freeze({ createGuide, toCapsulePage, connectPortal: activatePortal });
declare global {
  interface Window {
    __lotseGuide: typeof api;
  }
}
Object.defineProperty(window, "__lotseGuide", { value: api, configurable: true });
