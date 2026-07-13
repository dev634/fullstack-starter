"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  ClockIcon,
  PlusIcon,
  EllipsisVerticalIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";

type ClientsActionsMenuProps = {
  canEdit: boolean;
  exportHref: string;
};

export default function ClientsActionsMenu({ canEdit, exportHref }: ClientsActionsMenuProps) {
  const { t } = useTranslation();
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

  const itemClasses =
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
        {t.clients.list.actions}
        <EllipsisVerticalIcon className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 shadow-lg">
          <a href={exportHref} className={itemClasses} onClick={() => setOpen(false)}>
            <ArrowDownTrayIcon className="h-4 w-4" />
            {t.clients.list.exportCsv}
          </a>
          {canEdit && (
            <>
              <Link href="/clients/import" className={itemClasses} onClick={() => setOpen(false)}>
                <ArrowUpTrayIcon className="h-4 w-4" />
                {t.clients.list.import}
              </Link>
              <Link href="/clients/trash" className={itemClasses} onClick={() => setOpen(false)}>
                <TrashIcon className="h-4 w-4" />
                {t.clients.list.trash}
              </Link>
              <Link href="/clients/activity" className={itemClasses} onClick={() => setOpen(false)}>
                <ClockIcon className="h-4 w-4" />
                {t.clients.list.activity}
              </Link>
              <Link
                href="/clients/add"
                className={`${itemClasses} font-medium text-blue-600 dark:text-blue-400`}
                onClick={() => setOpen(false)}
              >
                <PlusIcon className="h-4 w-4" />
                {t.clients.list.addClient}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
