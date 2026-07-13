"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";

export type ActionMenuItem = {
  key: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Render a plain <a> (e.g. a route-handler download) instead of a Next <Link>. */
  external?: boolean;
  /** Extra classes for the item (e.g. to emphasise a primary action). */
  className?: string;
};

/**
 * Mobile-only "..." dropdown of link actions. Shared by the clients and
 * projects list headers — each passes its own translated `label` and `items`.
 */
export default function ActionsMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const baseItemClasses =
    "flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-[#d1d5dc] dark:hover:bg-gray-700";

  return (
    <div ref={menuRef} className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-[#d1d5dc] dark:hover:bg-gray-800 cursor-pointer"
      >
        {label}
        <EllipsisVerticalIcon className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 shadow-lg">
          {items.map(({ key, href, label: itemLabel, icon: Icon, external, className }) => {
            const classes = `${baseItemClasses}${className ? ` ${className}` : ""}`;
            const content = (
              <>
                <Icon className="h-4 w-4" />
                {itemLabel}
              </>
            );
            return external ? (
              <a key={key} href={href} className={classes} onClick={() => setOpen(false)}>
                {content}
              </a>
            ) : (
              <Link key={key} href={href} className={classes} onClick={() => setOpen(false)}>
                {content}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
