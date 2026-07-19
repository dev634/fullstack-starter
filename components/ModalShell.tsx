'use client'
import { type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";

type ModalShellProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

/**
 * The overlay + panel chrome shared by the section "add" modals (the header
 * CTAs on Tasks / Interventions / Subcontractors / Intérimaires). Each add
 * form keeps its own action + open state and closes itself on success — this
 * only owns the presentation so they don't each re-hand-roll the overlay.
 */
export default function ModalShell({ open, onClose, title, children }: ModalShellProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-4 border-b border-gray-300 px-6 py-4 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.cancel}
            className="shrink-0 cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-500/10 dark:text-gray-400"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
