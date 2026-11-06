"use client";
import { redirect } from "next/navigation";
import type { helperCopy } from "./copy.ts";
/** Compatibility component: the relatives helper view is the only join experience. */
export function HelperInvite({
  token,
}: {
  token: string;
  copy: (typeof helperCopy)[keyof typeof helperCopy];
}): never {
  redirect(/^[0-9a-f]{64}$/.test(token) ? `/helper#${token}` : "/helper");
}
