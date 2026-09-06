'use client'
import { useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

// Controlled mode: pass `open` together with `onOpenChange` when a parent
// needs to force the section open — e.g. reveal it after creating something
// inside. Omit both to keep the section fully self-contained (uncontrolled),
// which always starts CLOSED. A `defaultOpen` briefly existed to open a
// caller's sections on arrival; it was removed the day that decision was
// reversed rather than kept as an unused prop — an API nobody calls is dead
// code, not optionality.
type ControlMode =
  | { open: boolean; onOpenChange: (open: boolean) => void }
  | { open?: never; onOpenChange?: never };

type CollapsibleSectionProps = ControlMode & {
  icon: ReactNode;
  title: string;
  badge?: string;
  // Rendered next to the toggle (e.g. "Create folder") — kept outside the
  // toggle button itself so it stays independently clickable.
  headerExtra?: ReactNode;
  children: ReactNode;
};

export default function CollapsibleSection({
  icon,
  title,
  badge,
  headerExtra,
  open: openProp,
  onOpenChange,
  children,
}: CollapsibleSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;

  function toggle() {
    if (isControlled) onOpenChange?.(!open);
    else setUncontrolledOpen((v) => !v);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          // A floor (not min-w-0) so the title can never be squeezed to nothing
          // by its own header actions: once they no longer fit beside it, the
          // row's flex-wrap pushes them onto their own line instead.
          className="flex min-w-[8rem] flex-1 cursor-pointer items-center gap-2 text-left"
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
