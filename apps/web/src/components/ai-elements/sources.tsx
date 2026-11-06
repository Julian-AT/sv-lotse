"use client";

import { BookIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.tsx";
import { cn } from "@/lib/utils.ts";

export const Sources = ({ className, ...props }: ComponentProps<typeof Collapsible>) => (
  <Collapsible className={cn("text-xs text-primary", className)} {...props} />
);

export const SourcesTrigger = ({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className?: string;
}) => (
  <CollapsibleTrigger
    className={cn(
      "flex min-h-9 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-medium text-primary",
      className,
    )}
  >
    <BookIcon className="size-3.5" aria-hidden="true" />
    {label} ({count})
    <ChevronDownIcon className="size-3.5" aria-hidden="true" />
  </CollapsibleTrigger>
);

export const SourcesContent = ({
  className,
  ...props
}: ComponentProps<typeof CollapsibleContent>) => (
  <CollapsibleContent
    className={cn("mt-1 flex w-fit flex-col gap-1.5 data-[state=closed]:hidden", className)}
    {...props}
  />
);

export const Source = ({ href, title, children, ...props }: ComponentProps<"a">) => (
  <a
    className="flex items-center gap-2 text-primary"
    href={href}
    rel="noreferrer"
    target="_blank"
    {...props}
  >
    <BookIcon className="size-3.5" aria-hidden="true" />
    <span className="font-medium">{children ?? title}</span>
  </a>
);
