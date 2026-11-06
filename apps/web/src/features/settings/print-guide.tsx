"use client";

import type { JSX } from "react";

export function PrintGuide({ label }: { label: string }): JSX.Element {
  return (
    <button type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
