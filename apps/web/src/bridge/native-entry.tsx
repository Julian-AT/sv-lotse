"use client";

import { useEffect } from "react";
import { WORKSPACE_CONFIG } from "../conversation/config.ts";
import { hasNativeBridge } from "./index.ts";

/** The native host's default URL is the origin root. Enter its sole conversation client. */
export function NativeWorkspaceEntry(): null {
  useEffect(() => {
    if (hasNativeBridge()) window.location.replace(WORKSPACE_CONFIG.workspacePath);
  }, []);
  return null;
}
