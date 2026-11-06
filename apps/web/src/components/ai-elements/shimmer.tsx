// Ported from Vercel's AI Chatbot template (Apache-2.0); CSS keyframes replace the motion dependency.
import type { JSX } from "react";
import { cn } from "@/lib/utils.ts";

export function Shimmer({
  children,
  className,
}: {
  children: string;
  className?: string;
}): JSX.Element {
  return <span className={cn("shimmer-text inline-block font-medium", className)}>{children}</span>;
}
