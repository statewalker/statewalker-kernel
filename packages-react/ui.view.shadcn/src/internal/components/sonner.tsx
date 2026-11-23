"use client";

import type * as React from "react";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";

/**
 * Sonner's toaster, coloured by the shadcn tokens (`--popover`, `--border`), so it follows the
 * theme. Raise toasts with `toast(...)`.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster, type ToasterProps, toast };
