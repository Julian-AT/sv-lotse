"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

export const Actions = ({ className, children, ...props }: ComponentProps<"div">) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type ActionProps = ComponentProps<typeof Button> & { label: string };

export const Action = ({ label, className, children, ...props }: ActionProps) => (
  <Button
    aria-label={label}
    title={label}
    className={cn("size-8 rounded-lg text-muted-foreground hover:text-foreground", className)}
    size="icon"
    variant="ghost"
    {...props}
  >
    {children}
  </Button>
);
