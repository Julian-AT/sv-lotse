import { portalBookmarklet } from "../../../apps/web/src/features/guided-portal/bookmarklet.ts";
import { connectPortalWindow } from "../../../apps/web/src/features/guided-portal/portal-client.ts";
import type { PortalCommand, PortalConnection, PortalReply } from "../src/portal-contract.ts";

declare global {
  interface Window {
    portalReplies: PortalReply[];
    portalPopup: Window;
    portalConnection: PortalConnection;
    portalBookmark: string;
    sendPortal: (command: PortalCommand) => void;
  }
}
const popup = window.open("http://localhost:4178/plain.html");
if (!popup) throw new Error("Fixture popup unavailable");
window.portalPopup = popup;
window.portalReplies = [];
window.portalConnection = {
  workspaceOrigin: location.origin,
  portalOrigin: "http://localhost:4178",
  channel: crypto.randomUUID(),
  // Test-only local origin; product policy comes from the real knowledge registry.
  allowlist: ["http://localhost:4178"],
};
const client = connectPortalWindow(
  popup,
  window.portalConnection,
  (reply) => window.portalReplies.push(reply),
  () => {
    throw new Error("Fixture connection timed out");
  },
);
window.sendPortal = (command) => client.send(command);
window.portalBookmark = portalBookmarklet(window.portalConnection);
