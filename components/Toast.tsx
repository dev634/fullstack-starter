"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type ToastType = "success" | "error" | "zodError" | null;

// Single source of the stacking level: above every modal (z-50) and any
// dropdown (z-20). Tailwind needs the literal class, so it lives here only.
const TOAST_Z_INDEX = "z-60";

// Contrast (WCAG 2.x, computed — see the PR notes): white on red-600 4.83:1,
// black on green-500 9.22:1. The colours are the toast's own surface, so the
// pairs are identical in light and dark mode (no `dark:` variant needed).
const TOAST_COLORS = {
  success: "bg-green-500 text-black",
  error: "bg-red-600 text-white",
} as const;

const subscribe = () => () => {};
// `false` on the server and during hydration, `true` afterwards: the portal
// only exists client-side, and the first client render matches the server HTML.
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function Toast({ type, message }: { type: ToastType; message: string }) {
  const isClient = useIsClient();
  const text = typeof message === "string" ? message : "";
  const isError = type === "error" || type === "zodError";
  const visible = (isError || type === "success") && text !== "";

  return (
    <>
      {/* The only announcement: a live region present from the very first
          render (screen readers only track regions that already exist), kept
          in the form's own tree. The visual copy below is aria-hidden. */}
      <div
        className="sr-only"
        aria-live={isError ? "assertive" : "polite"}
        aria-atomic="true"
      >
        {visible ? text : ""}
      </div>
      {visible &&
        isClient &&
        createPortal(
          <div
            aria-hidden="true"
            className={`pointer-events-none fixed inset-x-5 top-32 ${TOAST_Z_INDEX} mx-auto max-w-xl break-words rounded px-4 py-2 text-center shadow-lg ${
              isError ? TOAST_COLORS.error : TOAST_COLORS.success
            }`}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
