"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/components/LocaleProvider";
import { useIsClient } from "@/components/useIsClient";
import { TOAST_HOST_ID } from "@/components/toastHost";
import type { ActionResultType } from "@/types/actionResult";

// How long a success stays on screen. An error never expires on its own
// (WCAG 2.2.1): it stays until the user closes it or a newer result replaces it.
const SUCCESS_DURATION_MS = 5000;

// Contrast (WCAG 2.x, computed on the Tailwind v4.2.2 palette): white on
// red-600 (#e7000b) 4.77:1, black on green-500 (#00c950) 9.47:1. The colours
// are the toast's own surface, so the pairs are identical in light and dark
// mode (no `dark:` variant needed).
const TOAST_COLORS = {
  success: "bg-green-500 text-black",
  error: "bg-red-600 text-white",
} as const;

type ToastProps = {
  type: ActionResultType;
  message: string;
  /**
   * The action state object itself. A NEW object is a new result, even with the
   * same text (two wrong passwords in a row): it re-shows a closed banner and
   * re-announces it. Optional: without it, only a change of type or message
   * counts as a new result.
   */
  result?: object;
};

/**
 * Message of a Server Action's outcome. Two parts:
 * - two always-mounted `sr-only` live regions in the form's own tree (a region
 *   must exist BEFORE its content for screen readers to announce it, and its
 *   politeness is fixed): the only announcement;
 * - the visible banner, portalled into the single host rendered by
 *   app/layout.tsx, which owns the position and the top-most z-index and
 *   stacks the banners of every form on the page.
 */
export function Toast({ type, message, result }: ToastProps) {
  const { t } = useTranslation();
  const isClient = useIsClient();
  const [seen, setSeen] = useState({ result, type, message });
  const [count, setCount] = useState(0);
  const [closedAt, setClosedAt] = useState(-1);

  // Adjusting OWN state while rendering is legal: each new result bumps `count`.
  if (seen.result !== result || seen.type !== type || seen.message !== message) {
    setSeen({ result, type, message });
    setCount(count + 1);
  }

  const isError = type === "error" || type === "zodError";
  const isSuccess = type === "success";
  const visible = (isError || isSuccess) && message !== "" && closedAt !== count;

  useEffect(() => {
    if (!isSuccess || message === "") return;
    const timer = setTimeout(() => setClosedAt(count), SUCCESS_DURATION_MS);
    return () => clearTimeout(timer);
  }, [count, isSuccess, message]);

  const host = isClient ? document.getElementById(TOAST_HOST_ID) : null;

  return (
    <>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {visible && isError ? <span key={count}>{message}</span> : null}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {visible && isSuccess ? <span key={count}>{message}</span> : null}
      </div>
      {visible &&
        host &&
        createPortal(
          <div
            key={count}
            className={`pointer-events-auto flex items-start gap-2 break-words rounded pl-4 shadow-lg ${
              isError ? TOAST_COLORS.error : TOAST_COLORS.success
            }`}
          >
            <p aria-hidden="true" className="min-w-0 flex-1 py-3">
              {message}
            </p>
            <button
              type="button"
              onClick={() => setClosedAt(count)}
              aria-label={t.common.close}
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded text-2xl leading-none hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-current"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>,
          host,
        )}
    </>
  );
}
