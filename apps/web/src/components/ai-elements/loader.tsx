import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils.ts";
import { MessageAvatar } from "./message.tsx";
import { Shimmer } from "./shimmer.tsx";

export type LoaderProps = HTMLAttributes<HTMLDivElement> & { label?: string };

/** The template's ThinkingMessage: avatar plus a shimmering waiting text. */
export const Loader = ({ className, label = "…", ...props }: LoaderProps) => (
  <div className={cn("flex w-full items-start gap-3", className)} {...props}>
    <MessageAvatar />
    <div className="flex min-h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
      <Shimmer>{label}</Shimmer>
    </div>
  </div>
);
