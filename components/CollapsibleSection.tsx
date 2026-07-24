'use client'
import { useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

type CollapsibleSectionProps = {
  icon: ReactNode;
  title: string;
  badge?: string;
  // Rendered next to the toggle (e.g. "Create folder") — kept outside the
  // toggle button itself so it stays independently clickable.
  headerExtra?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

export default function CollapsibleSection({
  icon,
  title,
  badge,
  headerExtra,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
          )}
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
            {icon}
            <span className="truncate">{title}</span>
            {badge && (
              <span className="shrink-0 text-sm font-normal text-gray-500 dark:text-gray-400">{badge}</span>
            )}
          </h2>
        </button>
        {headerExtra}
      </div>
      {open && children}
    </>
  );
}
