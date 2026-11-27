"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useIsClient } from "@/components/useIsClient";

/**
 * Renders its children directly under `document.body`, so no ancestor's
 * stacking context (an `absolute z-10` card, a transformed row…) can trap a
 * full-screen overlay beneath its siblings. Renders nothing on the server.
 */
export default function BodyPortal({ children }: { children: ReactNode }) {
  const isClient = useIsClient();
  return isClient ? createPortal(children, document.body) : null;
}
