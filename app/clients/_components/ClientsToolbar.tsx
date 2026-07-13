"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MagnifyingGlassIcon, BarsArrowUpIcon, BarsArrowDownIcon, FunnelIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";

export default function ClientsToolbar() {
  const { t } = useTranslation();
  const SORT_OPTIONS: { value: string; label: string }[] = [
    { value: "firstName", label: t.clients.toolbar.sortFirstName },
    { value: "lastName", label: t.clients.toolbar.sortLastName },
    { value: "companyName", label: t.clients.toolbar.sortCompany },
    { value: "email", label: t.clients.toolbar.sortEmail },
  ];
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const first = useRef(true);
  const filtersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filtersOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) {
        setFiltersOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [filtersOpen]);

  const sort = params.get("sort") ?? "firstName";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  // Push a new query string, always resetting to page 1 on any change.
  function push(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    sp.delete("page");
    router.push(`${pathname}?${sp.toString()}`);
  }

  // Debounce the search box so we don't navigate on every keystroke.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => push({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.clients.toolbar.searchPlaceholder}
            aria-label={t.clients.toolbar.searchLabel}
            className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-10 pr-3 text-gray-900 dark:text-gray-100 placeholder-gray-500"
          />
        </div>

        <div ref={filtersRef} className="relative sm:hidden">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-haspopup="true"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-[#d1d5dc] dark:hover:bg-gray-700 cursor-pointer"
          >
            <FunnelIcon className="h-4 w-4" />
            {t.clients.toolbar.filters}
          </button>

          {filtersOpen && (
            <div className="absolute right-0 top-full z-20 mt-2 w-56 flex flex-col gap-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-lg">
              <select
                value={sort}
                onChange={(e) => push({ sort: e.target.value })}
                aria-label={t.clients.toolbar.sortLabel}
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => push({ dir: dir === "asc" ? "desc" : "asc" })}
                className="inline-flex items-center justify-center gap-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-[#d1d5dc] dark:hover:bg-gray-700 cursor-pointer"
              >
                {dir === "asc" ? <BarsArrowUpIcon className="h-5 w-5" /> : <BarsArrowDownIcon className="h-5 w-5" />}
                {dir === "asc" ? t.clients.toolbar.sortAsc : t.clients.toolbar.sortDesc}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-2">
        <select
          value={sort}
          onChange={(e) => push({ sort: e.target.value })}
          aria-label={t.clients.toolbar.sortLabel}
          className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => push({ dir: dir === "asc" ? "desc" : "asc" })}
          aria-label={dir === "asc" ? t.clients.toolbar.sortAsc : t.clients.toolbar.sortDesc}
          className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-600 dark:text-gray-300 hover:bg-[#d1d5dc] dark:hover:bg-gray-700 cursor-pointer"
        >
          {dir === "asc" ? <BarsArrowUpIcon className="h-5 w-5" /> : <BarsArrowDownIcon className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
