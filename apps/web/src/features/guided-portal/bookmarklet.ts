import type { PortalConnection } from "@lotse/guide/portal";
import { GUIDED_PORTAL_CONFIG } from "./config.ts";

/** No values or credentials in the bookmark: it only activates a guide channel. */
export function portalBookmarklet(connection: PortalConnection): string {
  const scriptUrl = new URL(GUIDED_PORTAL_CONFIG.runtimePath, connection.workspaceOrigin).href;
  const configuration = JSON.stringify(connection).replace(/</gu, "\\u003c");
  return `javascript:void((()=>{const c=${configuration};if(location.origin!==c.portalOrigin||!window.opener)return;const start=()=>window.__lotseGuide.connectPortal(c);if(window.__lotseGuide){start();return;}const s=document.createElement('script');s.src=${JSON.stringify(scriptUrl)};s.onload=start;document.head.appendChild(s);})())`;
}
